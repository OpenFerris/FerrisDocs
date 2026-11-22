---
title: Integraciones
description: Webhooks, OAuth, Google, LDAP y las reglas de automatización, con
  sus DocTypes, secretos y límites de entrega.
slug: 0.2/guias/integraciones
---

El crate `ferris-integrations` tiene dos capas separadas:

* **declaraciones** — los DocTypes y el workspace del Desk. Siempre están, aunque
  el runtime no esté compilado, para que el Desk sepa qué *es* una integración;
* **runtime** — detrás del feature `runtime`: hooks de documento que disparan
  webhooks, flujos de automatización, reglas de asignación, hitos, auto-repeat,
  recordatorios, auto-email y los adaptadores OAuth/Google/LDAP.

`ferris-server` enciende `runtime` con sus roles. Un build sin él muestra los
DocTypes y no ejecuta nada.

## DocTypes

| DocType | Tipo | Para qué |
|---|---|---|
| `Webhook` | lista | llamada HTTP disparada por un evento de documento |
| `OAuth Provider` | lista | proveedor OAuth2 externo al que se delega |
| `Connected App` | lista | aplicación externa contra la que se autentica Ferris |
| `OAuth Client` | lista | cliente OAuth2 registrado en esta instalación |
| `Social Login Key` | lista | proveedor de login social |
| `Google Settings` | **single** | credenciales de Google |
| `LDAP Settings` | **single** | directorio LDAP |
| `Automation Flow` | lista | regla evento → acciones |
| `Assignment Rule` | lista | asignación automática de documentos |
| `Milestone` | lista | hito del ciclo de vida de un documento |
| `Auto Repeat` | lista | duplicado recurrente de un documento |
| `Auto Email Report` | lista | informe enviado por correo según calendario |
| `Reminder` | lista | recordatorio programado |
| `Push Notification` | lista | notificación encolada |
| `Google Contacts` / `Google Calendar` | lista | sincronización |
| `Notification` | — | feed in-app (lo escribe este crate, lo declara `ferris-api`) |

Todos los metadatos son `System Manager` por defecto: son configuración de
instalación, no datos de negocio.

## Webhooks

Una fila `Webhook` se dispara cuando ocurre `webhook_docevent` sobre
`webhook_doctype`:

| Campo | Nota |
|---|---|
| `webhook_doctype` | DocType observado (obligatorio) |
| `webhook_docevent` | `after_insert`, `on_update`, `on_submit`, `on_cancel`, `on_trash` |
| `condition` | expresión que decide si se dispara |
| `request_url`, `request_method` | destino; `POST`, `PUT`, `PATCH` o `DELETE` |
| `request_headers`, `request_body` | plantillas renderizadas contra el documento |
| `webhook_secret` | campo `Secret`; firma el cuerpo |
| `enabled` | interruptor |

### Firma

Con `webhook_secret`, el cuerpo se firma con **HMAC-SHA256** y se envía en hex:

```text
X-Ferris-Webhook-Signature: 5f2c…9ab
```

Verifica la firma en el receptor antes de confiar en el cuerpo. Sin secreto no
hay firma, y un receptor no puede distinguir un webhook legítimo de uno forjado.

### Entrega

```text
evento → condición → render de headers/body → POST → 2xx
                                             → error → se registra y se devuelve
```

En la ruta de guardado la entrega es **best effort**: un endpoint lento o caído no
debe dejar la escritura del documento esperando. El fallo se registra y se
devuelve, pero el hook no lo propaga. Las entregas de `run_for_event` son
secuenciales para conservar el orden por disparo.

:::caution[Un webhook no es una transacción]
El documento ya está escrito cuando el webhook sale. Si el receptor necesita
consistencia, hazlo idempotente (una clave en el payload) y no asumas que llegará
exactamente una vez.
:::

`[features] webhooks = false` desactiva **solo** el despacho de webhooks: la
automatización, asignación, hitos y push siguen funcionando. Es un gate de
runtime; si el binario no compiló `integrations`, el arranque falla al pedirlo.

## Automatización y reglas

`Automation Flow` conecta un evento con acciones; `Assignment Rule` asigna
documentos nuevos a un usuario o rol; `Milestone` marca un punto del ciclo de
vida. Los tres corren en el runtime y **no** se apagan con el flag `webhooks`.

Los jobs que necesitan (auto-repeat, recordatorios, auto-email) se registran en el
despachador de la cola de la app, así que requieren un proceso con el rol
`worker`. Ver [trabajos y scheduler](/0.2/guias/trabajos-y-scheduler/).

## OAuth, Google y LDAP

* `OAuth Provider` describe un proveedor externo; `OAuth Client` un cliente
  registrado aquí; `Connected App` la app externa contra la que Ferris se
  autentica. El baile OAuth2/PKCE lo implementa `ferris-auth`, no el runtime de
  integraciones.
* `Google Settings` guarda `client_secret` y `refresh_token` en campos `Secret`.
* `LDAP Settings` guarda `bind_password` en un campo `Secret` y describe el
  directorio para autenticar usuarios.

:::danger[Los secretos nunca se imprimen]
`Debug` de estos tipos redacta el valor, y `ferris config show` enmascara. Si
copias una fila a un log o a un ticket, estás filtrando la credencial: los campos
`Secret` existen para que no tengas que hacerlo a mano.
:::

## Seguridad

* Los webhooks salen del host, no del guest: la app no abre sockets.
* Un secreto de webhook es material del operador; no lo pongas en
  `config` de una app (las claves `secret` son del operador, no del guest).
* Las URLs de webhook deberían ser de confianza: no hay allow-list de destinos en
  esta capa. Si necesitas una, ponla delante (egress del contenedor o proxy).
* Firma siempre que el receptor vaya a actuar sobre el cuerpo.

## Checklist

* \[ ] `integrations` compilado y el runtime encendido.
* \[ ] `[features] webhooks = true` si esperas entregas.
* \[ ] `webhook_doctype` y `webhook_docevent` coinciden con el evento real.
* \[ ] `condition` no filtra de más (una condición mal escrita no dispara nada).
* \[ ] El receptor verifica `X-Ferris-Webhook-Signature`.
* \[ ] Hay un `worker` consumiendo los jobs de auto-repeat/recordatorios.
* \[ ] Los campos `Secret` no se copian fuera de la base de datos.
