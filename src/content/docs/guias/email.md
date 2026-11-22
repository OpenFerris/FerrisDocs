---
title: Email
description: Cuentas SMTP/IMAP, cola de envío, plantillas y el trabajador que entrega, con reintentos y fallos.
---

El correo en Ferris va en dos direcciones y con una **cola** en el medio: se
encola un envío, un worker lo entrega por SMTP y el resultado queda persistido
en `Email Queue`; y un poller por cuenta lee el buzón por IMAP, guarda cada
mensaje como `Inbound Email` y avisa en el feed in-app.

:::caution[El transporte es SMTP saliente + IMAP entrante]
Ferris envía por SMTP y recibe por IMAP. No hay integración con APIs
propietarias de envío (SendGrid, Mailgun, SES-API…) en esta versión. Si tu
proveedor solo ofrece API HTTP, necesitas un relay SMTP delante.
:::

## Configuración

```toml
[features]
email = true

[email]
default_account = "notificaciones"
queue_concurrency = 4
retry_attempts = 3
retry_delay_secs = 60

[[email.accounts]]
name = "notificaciones"
email = "no-reply@example.com"
smtp_host = "smtp.example.com"
smtp_port = 587
smtp_username = "no-reply@example.com"
smtp_password = "…"
smtp_tls = false
smtp_starttls = true
# Entrante: con `imap_host` el poller de esta cuenta arranca; sin él, no.
imap_host = "imap.example.com"
imap_port = 993
imap_username = "no-reply@example.com"
imap_password = "…"
imap_tls = true
imap_starttls = false
```

| Clave | Efecto |
|---|---|
| `default_account` | cuenta usada cuando el job no nombra una |
| `queue_concurrency` | envíos en paralelo del worker |
| `retry_attempts` / `retry_delay_secs` | política de reintento de la cola |
| `smtp_tls` | TLS implícito (normalmente puerto 465) |
| `smtp_starttls` | upgrade STARTTLS (normalmente 587) |
| `imap_host` | servidor entrante; su ausencia desactiva IMAP para la cuenta |
| `imap_port` | 993 con TLS implícito, 143 con STARTTLS |
| `imap_username` | usuario IMAP; si falta se usa `email` |
| `imap_password` | contraseña IMAP |
| `imap_tls` / `imap_starttls` | TLS implícito o upgrade STARTTLS; excluyentes |

`Password` es un `Secret`: `Debug` lo redacta y ningún informe de `ferris config
show` lo imprime. Las credenciales que usa el runtime viven en
`[email.accounts]`; el DocType `Email Account` replica el buzón en el Desk y
declara `smtp_password`/`imap_password` como `Secret` (cifrados en reposo y
enmascarados al leer), pero el hub y el poller se construyen desde el TOML.

:::note[El runtime lee `[email.accounts]`]
Crear o editar una fila de `Email Account` en el Desk **no** arranca un poller ni
cambia el transporte en caliente. Para recibir correo, configura la cuenta en
`[email.accounts]` y reinicia el proceso.
:::

Las dos credenciales usan `rustls` (backend `ring`), nunca `native-tls`. Una
cuenta con `imap_host` pero sin TLS ni STARTTLS se rechaza al arrancar: el
cliente no autentica en claro salvo que se pida explícitamente
(`allow_plaintext`, reservado a loopback y pruebas), y el servidor no expone esa
opción en `[email.accounts]`.

## Correo entrante (IMAP)

Con `imap_host` configurado, el proceso que tiene el rol `worker` o `scheduler`
arranca **un poller por cuenta**. El poller vive con el hub de email y se apaga
con el `shutdown` del servidor.

```text
conectar (TLS 993 | STARTTLS 143) → LOGIN → SELECT INBOX
  → UID SEARCH UNSEEN
  → por cada UID: UID FETCH <uid> (UID RFC822)
       → MIME (from/to/subject/text/html/adjuntos)
       → escribir Inbound Email
       → notificación in-app
       → UID STORE +FLAGS (\Seen)
  → LOGOUT
```

| Aspecto | Comportamiento |
|---|---|
| Cadencia | polling cada 60 s; **no** hay IDLE, así que la latencia máxima es el intervalo |
| Límite por mensaje | 25 MiB; uno mayor se descarta del ciclo y **queda sin leer** |
| Fallo de guardado | el mensaje **no** se marca leído; se reintenta con backoff exponencial (10 s → 15 min) |
| Mensaje malformado | se registra el UID y queda sin leer; el resto del buzón sigue |
| Idempotencia | clave `(account, mailbox, imap_uid)`; un re-fetch no duplica |
| Hilo | `In-Reply-To` enlaza con el `Inbound Email` cuyo `message_id` coincide |
| Adjuntos | el documento guarda nombre, tipo y tamaño; los bytes no se copian |

`Inbound Email` conserva `subject`, `from`, `to`, `body`, `html`, `raw` (el
fuente RFC822), `status` (`New`, `Replied`, `Archived`, `Spam`), `message_id`,
`in_reply_to`, `thread`, `account`, `mailbox`, `imap_uid` y `received_at`. El
aviso in-app se dirige a la dirección de la cuenta (`Notification.user`); no hay
una clave separada para elegir otro destinatario.

Un mensaje que no se puede guardar **no se pierde**: sigue en el buzón y se
reintenta. Un mensaje que supera el límite o no parsea tampoco se borra; se
queda sin leer y el aviso se repite en cada ciclo, que es la señal de que hay que
subir el límite o revisar el mensaje.


## Enviar

Hay tres formas, y las tres acaban en la misma cola:

1. **DocType `Email Queue`** — una fila encolada;
2. **handler de job** — `send_email` con el payload de `EmailJob`;
3. **plantilla** — `send_templated_email`, que resuelve `template` +
   `template_context`.

```json
{
  "account": "notificaciones",
  "from": "no-reply@example.com",
  "to": ["ana@example.com"],
  "subject": "Tu informe",
  "html": "<p>Listo</p>",
  "text": "Listo",
  "template": null,
  "template_context": null,
  "attachments": []
}
```

Campos relevantes de `EmailJob`: `cc`, `bcc`, `reply_to`, `in_reply_to`,
`references`, `attachments`, `priority`. Los adjuntos son **referencias**
(`AttachmentRef`), no bytes embebidos: el worker los resuelve en el servicio de
ficheros.

## Plantillas

`EmailTemplate` es un documento con `subject`, `html_template`, `text_template` y
la lista de `variables` esperadas:

```json
{
  "name": "bienvenida",
  "subject": "Hola {{ nombre }}",
  "html_template": "<h1>Bienvenido, {{ nombre }}</h1>",
  "text_template": "Bienvenido, {{ nombre }}",
  "variables": ["nombre"]
}
```

El renderizador sustituye las variables del `template_context`. Una variable
faltante deja el hueco visible (no rompe el envío) y una plantilla inexistente
falla el job con `not-found`, que es reintentable solo si la plantilla aparece.

## El worker

El handler `EmailJobHandler` enruta por `ctx.job_name`:

| `job_name` | Qué hace |
|---|---|
| `send_email` | entrega un `EmailJob` tal cual |
| `send_templated_email` | renderiza la plantilla y luego entrega |
| `email` | agrupa: despacha a los dos anteriores |

Necesita el rol `worker` (o el proceso que consuma la cola) y el vertical `email`
compilado. Sin worker, los jobs se acumulan en `Email Queue` y **no se envían**:
la API responde que encoló, no que entregó.

## Fallos y reintentos

```text
encolar → worker → SMTP acepta        → enviado
                 → SMTP 5xx           → fallo permanente (buzón inexistente, política)
                 → SMTP 4xx           → temporal: reintento con backoff
                 → timeout / conexión → temporal: reintento con backoff
                 → agotados           → dead-letter, visible en la cola
```

- el estado final vive en `Email Queue`, no en un log;
- un fallo permanente no debe reintentarse: es la diferencia entre «el buzón no
  existe» y «el servidor no responde»;
- los reintentos son los de la cola de trabajos (`retry_attempts`,
  `retry_delay_secs`), no un bucle dentro del handler.

:::note[Enviar no es entregar]
SMTP acepta el mensaje y eso es todo lo que Ferris puede saber. Una rebaja,
un spam-filter o un rebote llegan después, por IMAP o fuera del sistema. No
prometas entrega en tu UI.
:::

## Seguridad

- **Nunca** pongas credenciales SMTP en un DocType que el guest pueda leer: usa el
  campo `Secret` o el TOML con `SecretValue`.
- El host no registra el cuerpo del mensaje en los logs de fallo, solo la cuenta y
  el destinatario.
- Una app puede pedir `io::notify(..., "email", ...)` sin gestionar SMTP: el
  transporte es del host. Eso es preferible a construir el mensaje a mano.

## Checklist

- [ ] `email` compilado y `[features] email = true`.
- [ ] `default_account` existe en `[[email.accounts]]`.
- [ ] Puerto y modo TLS coinciden (`465` + `smtp_tls`, o `587` + `smtp_starttls`).
- [ ] Un proceso con el rol `worker` consume la cola.
- [ ] Las plantillas existen antes de encolar `send_templated_email`.
- [ ] Los adjuntos son referencias válidas del servicio de ficheros.
- [ ] Para entrante: `imap_host` + credenciales y `imap_tls`/`imap_starttls`
      coherentes con el puerto.
- [ ] El proceso que recibe tiene rol `worker` o `scheduler` (el poller vive con
      el hub de email).
- [ ] El buzón remoto conserva los mensajes no leídos que Ferris no pudo
      guardar; no los borres a mano antes del siguiente ciclo.
