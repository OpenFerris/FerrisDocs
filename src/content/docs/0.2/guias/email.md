---
title: Email
description: Cuentas SMTP/IMAP, cola de envío, plantillas y el trabajador que
  entrega, con reintentos y fallos.
slug: 0.2/guias/email
---

El correo en Ferris es una **cola**, no una llamada bloqueante: se encola un
trabajo, un worker lo entrega por SMTP y el resultado queda persistido en
`Email Queue`.

:::caution[El único transporte es SMTP]
Ferris envía por SMTP y lee por IMAP. No hay integración con APIs propietarias de
envío (SendGrid, Mailgun, SES-API…) en esta versión. Si tu proveedor solo ofrece
API HTTP, necesitas un relay SMTP delante.
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
```

| Clave | Efecto |
|---|---|
| `default_account` | cuenta usada cuando el job no nombra una |
| `queue_concurrency` | envíos en paralelo del worker |
| `retry_attempts` / `retry_delay_secs` | política de reintento de la cola |
| `smtp_tls` | TLS implícito (normalmente puerto 465) |
| `smtp_starttls` | upgrade STARTTLS (normalmente 587) |

`Password` es un `Secret`: `Debug` lo redacta y ningún informe de `ferris config
show` lo imprime. Aun así, la fuente recomendada es el campo `Secret` del DocType
`Email Account`, no el TOML.

IMAP es opcional y se configura por cuenta (`imap_host`, `imap_port`,
`imap_username`, `imap_password`, `imap_tls`, `imap_starttls`); sirve para leer
respuestas, no para enviar.

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

* el estado final vive en `Email Queue`, no en un log;
* un fallo permanente no debe reintentarse: es la diferencia entre «el buzón no
  existe» y «el servidor no responde»;
* los reintentos son los de la cola de trabajos (`retry_attempts`,
  `retry_delay_secs`), no un bucle dentro del handler.

:::note[Enviar no es entregar]
SMTP acepta el mensaje y eso es todo lo que Ferris puede saber. Una rebaja,
un spam-filter o un rebote llegan después, por IMAP o fuera del sistema. No
prometas entrega en tu UI.
:::

## Seguridad

* **Nunca** pongas credenciales SMTP en un DocType que el guest pueda leer: usa el
  campo `Secret` o el TOML con `SecretValue`.
* El host no registra el cuerpo del mensaje en los logs de fallo, solo la cuenta y
  el destinatario.
* Una app puede pedir `io::notify(..., "email", ...)` sin gestionar SMTP: el
  transporte es del host. Eso es preferible a construir el mensaje a mano.

## Checklist

* \[ ] `email` compilado y `[features] email = true`.
* \[ ] `default_account` existe en `[[email.accounts]]`.
* \[ ] Puerto y modo TLS coinciden (`465` + `smtp_tls`, o `587` + `smtp_starttls`).
* \[ ] Un proceso con el rol `worker` consume la cola.
* \[ ] Las plantillas existen antes de encolar `send_templated_email`.
* \[ ] Los adjuntos son referencias válidas del servicio de ficheros.
