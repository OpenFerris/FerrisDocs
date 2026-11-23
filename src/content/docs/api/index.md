---
title: API HTTP
description: Base URL, convenciones, autenticación, CSRF, grupos de endpoints y forma de los errores de la API de Ferris.
---

La API la sirve el rol `api` del proceso (`[server] roles` o `ferris serve --api`).
Todas las rutas viven bajo `/api`, salvo `/health` y los assets estáticos. Las
rutas de recurso son genéricas por DocType: un DocType nuevo queda servido sin
escribir un endpoint, y las reglas viven en su metadata, no en el router.

## Base URL

```text
http://localhost:8000
```

El puerto sale de `[server] port` en `config/ferris.toml`, o de `--port` en
`ferris serve`/`ferris dev` (8000 por defecto). Detrás de un proxy inverso, la
URL pública es la que configures en `[server] external_url`.

## Versionado

No hay versión en la ruta: no existe `/api/v1/…`. El número de versión aparece
solo en el documento OpenAPI:

```bash
curl -s http://localhost:8000/api/openapi.json | jq '.info'
```

`info.version` es la versión del paquete (`0.4.0`). Un cambio incompatible se
comunica con la versión del paquete y con el contrato WIT, no con un prefijo de
URL.

## Convenciones

| Aspecto | Convención |
|---|---|
| Cuerpo | JSON (`application/json`), objeto o array según el endpoint |
| Identificadores | `{doctype}` es el nombre del DocType tal cual (`"Task"`, `"Sales Order"`) |
| `{name}` | La clave primaria del documento, no un id numérico |
| Mayúsculas | Los nombres de campo son los de la metadata (`due_date`, `docstatus`) |
| Listas | Devuelven `data`, `total`, `limit`, `offset`, `page`, `page_size` |
| Crear | `POST` responde `201` con el documento |
| Borrar | `DELETE` responde `204` sin cuerpo |
| Seguridad | Cookie de sesión + `X-CSRF-Token` en métodos mutantes |

Un listado real:

```json
{
  "data": [{ "name": "TASK.00001", "subject": "Revisar el README" }],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "page": 1,
  "page_size": 20
}
```

## Autenticación

Tres credenciales aceptadas, resueltas en este orden por el middleware:

1. `Authorization: Bearer <jwt>` — JWT HS256 validado con `FERRIS_JWT_SECRET`.
2. `Authorization: token <key>:<secret>` — API key de Frappe.
3. Cookie de sesión `ferris_session`.

El login por HTTP abre una **sesión en cookie** y devuelve el token CSRF en la
cabecera `X-CSRF-Token`. Todos los detalles, incluidos MFA y OAuth, están en
[autenticación](/api/autenticacion/).

:::danger[CSRF en métodos mutantes]
Si autenticas con cookie, `POST`, `PUT`, `PATCH` y `DELETE` exigen la cabecera
`X-CSRF-Token` con el token de **esa** sesión. Sin ella la respuesta es `403`
con el texto `CSRF token missing or invalid`. `GET`/`HEAD`/`OPTIONS` están
exentos, igual que las llamadas con Bearer JWT.
:::

## Grupos de endpoints

| Grupo | Rutas |
|---|---|
| Sesión | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `POST /api/auth/mfa/verify` |
| MFA | `POST /api/auth/mfa/enable`, `/activate`, `/disable` |
| OAuth | `GET /api/oauth/providers`, `/api/oauth/{provider}/login`, `/callback` |
| Recursos | `GET/POST /api/resource/{doctype}`, `POST /api/resource/{doctype}/list`, `GET/PUT/DELETE /api/resource/{doctype}/{name}` |
| Ciclo de vida | `POST …/{name}/submit`, `/cancel`, `/amend`, `/rename`, `GET …/{name}/neighbors` |
| Singles | `GET/PUT /api/single/{doctype}` |
| Metadatos | `GET /api/doctype/meta/{doctype}`, `/actions`, `/connections`, `/permissions` |
| Permisos | `GET/PUT /api/doctype/permissions/{doctype}/manage`, `GET/POST/DELETE /api/authz/role-permissions` |
| Métodos | `POST /api/method/{method}`, `/api/jsonrpc`, `/api/batch`, `/api/graphql` |
| Esquema | `GET /api/openapi.json` |
| Desk | `GET /api/modules`, `/api/site-settings`, `/api/themes`, `/api/ui-extensions` |
| Paneles | `GET /api/notifications`, `…/stream`, `POST …/read`, `…/{name}/read`, `…/dismiss`, `GET /api/events`, `/api/notification-settings`, `/api/desk-layout` |
| Dashboards | `GET/PUT/DELETE /api/dashboard-layout/{owner}/{dashboard}`, `GET/PUT /api/dashboard-layout/doc/{doctype}/{name}`, `GET/PUT /api/dashboard-settings` |
| Búsqueda | `GET /api/search?q=…` (solo si `[features] search`) |
| Engagement | `/api/engagement/{doctype}/{name}/…` (like, comments, assignments, attachments, shares) |
| Actividad | `GET /api/activity/{doctype}/{name}` |
| Personalización | `/api/customization/{doctype}/…` |
| Desired state | `GET /api/desired-state`, `GET/PUT/DELETE /api/desired-state/{entity}` |
| Impresión | `/api/print/…` (solo con `print`) |
| Informes | `/api/report/…` (solo con `report`) |

Las rutas de una feature apagada **no existen**: el servidor responde `404`, que
es distinto de "sin resultados".

## Cabeceras útiles

| Cabecera | Uso |
|---|---|
| `Content-Type: application/json` | Obligatoria en cuerpos JSON |
| `Cookie: ferris_session=…` | Sesión abierta por el login |
| `X-CSRF-Token` | Token de la sesión, exigido al mutar con cookie |
| `If-None-Match` | Pull condicional de `/api/desired-state/{entity}` (responde `304`) |
| `X-Forwarded-For` / `X-Real-IP` | IP usada para el bloqueo por intentos fallidos |

## Errores

El cuerpo de error es siempre el mismo objeto:

```json
{ "error": "not_found", "message": "document not found: Task/TASK.99999" }
```

- `error` es una etiqueta estable derivada del estado HTTP (`not_found`,
  `bad_request`, `conflict`, `unauthorized`, `forbidden`, `internal_error`, …).
- `message` describe el fallo en un `4xx` y es **siempre** `"internal error"` en
  un `5xx`; el detalle se registra en el log, no se filtra al cliente.
- Un `401` añade `WWW-Authenticate: Bearer` y `Cache-Control: no-store`.

La tabla completa de mapeos está en
[errores y permisos](/api/errores-y-permisos/); la taxonomía interna, en
[referencia de errores](/referencia/errores/).
