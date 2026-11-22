---
title: Errores y permisos
description: Forma del error de la API, mapeo de la taxonomía de Ferris a
  códigos HTTP y cómo se decide un permiso.
slug: 0.2/api/errores-y-permisos
---

## Forma del error

Todo error que produce un handler de la API es el mismo objeto JSON:

```json
{ "error": "forbidden", "message": "permission denied: read on Task" }
```

| Campo | Origen |
|---|---|
| `error` | Etiqueta derivada del estado HTTP: `not_found`, `bad_request`, `conflict`, `unauthorized`, `forbidden`, `method_not_allowed`, `gateway_timeout`, `internal_error`, … |
| `message` | Texto del error en `4xx`; `"internal error"` en `5xx` |

El `5xx` se redacta: el texto real puede contener SQL, rutas, nombres
de tabla o una pila de causas. Se registra en el log del servidor con nivel
`error`, y al cliente solo le llega que algo falló.

## Mapeo de la taxonomía a HTTP

La traducción vive en un único sitio (`ferris-api/src/router/error.rs`):

| Error de `ferris-core` | HTTP |
|---|---|
| `DocumentError::NotFound`, `SchemaError::DocTypeNotFound`, `AuthError::NotFound`, `FileError::NotFound`, `JobError::NotFound`/`QueueNotFound`, `SearchError::IndexNotFound`, `WorkflowError::NotFound`, `EmailError::NotFound`, `TenantError::NotFound` | `404` |
| `ValidationError`, `AuthzError::InvalidPolicy` | `400` |
| `DocumentError::AlreadyExists`, `WorkflowError::AlreadyExists`, `TenantError::AlreadyExists`, `SchemaError::DuplicateField` | `409` |
| `AuthError::TooManySessions` | `429` |
| Cualquier otro `AuthError` | `401` |
| Cualquier otro `AuthzError` | `403` |
| `SecretError::NotRecoverable`, `SecretError::UnknownKeyId` | `409` |
| `DocumentError::SingleNotCreatable`, `SingleNotDeletable` | `405` |
| `JobError::Timeout` | `504` |
| Todo lo demás | `500` |

Los `401` añaden `WWW-Authenticate: Bearer` y `Cache-Control: no-store`. El
login y el MFA tienen su propio camino y añaden `Cache-Control: no-store` a sus
`401`/`429`.

:::note[CSRF no devuelve JSON]
El middleware CSRF corta la petición con `403` y cuerpo de **texto plano**:
`CSRF token missing or invalid`. No es un `ApiError`. Si tu cliente solo parsea
JSON, va a fallar en este caso concreto; comprueba el `Content-Type` antes.
:::

## Permisos: de dónde salen

Un permiso se evalúa en el **motor de documentos**, no en el handler. Hay tres
fuentes que se combinan:

1. **Reglas declaradas** en el DocType (`RolePermission` en Rust). Se traducen a
   una política instalada al arrancar.
2. **Filas `DocPerm`** persistidas (`Custom DocPerm`), que se aplican encima de
   las declaradas para el mismo `(doctype, role, permlevel)`.
3. **La política base**: `System Manager` puede todo. Sin ninguna regla
   declarada, un DocType queda solo para `System Manager`.

Los derechos evaluados son los de Frappe: `read`, `write`, `create`, `delete`,
`submit`, `cancel`, `amend`, `print`, `email`, `share`, `report`, `import`,
`export`.

### `if_owner`

```rust
RolePermission::new("Projects User").read().write().if_owner()
```

La regla solo se cumple si el documento pertenece al llamador (`owner`). Es la
forma habitual de dar a un usuario acceso a "sus" documentos sin abrir la tabla
entera.

### Permisos a nivel de campo (`permlevel`)

Un campo con `permlevel > 0` no se lee ni se escribe salvo que el llamador tenga
una regla con ese mismo nivel para la acción. Nivel 0 es el documento completo y
`System Manager` siempre pasa. Al leer, el campo restringido se **elimina** de la
respuesta; al escribir, se **descarta** del cuerpo y el valor almacenado queda
intacto (no es un error, es un campo que no existe para ti).

:::caution[DocPerm por encima del nivel 0]
Una fila `DocPerm` con `permlevel != 0` se **guarda** pero no se traduce a
sentencias de política (se reporta como no traducida). El control de campo se
evalúa contra las reglas declaradas en la metadata. Si necesitas permisos de
campo persistentes, decláralos en el DocType; no los escribas solo como fila.
:::

### Tipos de permiso personalizados

Un DocType puede declarar tipos como `approve` (filas de `Permission Type`) y
asignarlos a roles. La API los expone en:

```text
GET /api/doctype/permissions/{doctype}          → tipos y si TÚ los tienes
GET /api/doctype/permissions/{doctype}/manage   → matriz rol × tipo
PUT /api/doctype/permissions/{doctype}/manage   → {role, perm_type, granted}
```

El `PUT` reinstala la política al terminar, así que el cambio es inmediato.

## Cómo se comporta cada operación sin permiso

| Operación | Sin `read` | Sin `write` |
|---|---|---|
| `GET /api/resource/{doctype}` (lista) | El documento **no aparece** y no cuenta en `total` | — |
| `GET /api/resource/{doctype}/{name}` | `403` | — |
| `POST /api/resource/{doctype}` | — | `403` sin `create` |
| `PUT /api/resource/{doctype}/{name}` | — | `403` |
| `DELETE /api/resource/{doctype}/{name}` | — | `403` sin `delete` |
| `submit`/`cancel`/`amend` | — | `403` sin el derecho correspondiente |
| `neighbors` | `403` si no puedes leer el documento de referencia | — |
| Engagement, actividad, shares | `403` si no puedes leer el documento | `403` si no puedes escribirlo (o compartirlo, para shares) |

La lista filtra en SQL y cuenta sobre lo que sobrevive, de modo que `total` no
revela filas ajenas. La lectura individual sí distingue: `403` (existe pero no
puedes) frente a `404` (no existe). Es un oráculo de existencia, igual que en
Frappe.

## Diagnóstico

```bash
# ¿Qué reglas ve el servidor para este DocType?
curl -s -b cookies.txt \
  http://localhost:8000/api/doctype/permissions/Task/manage | jq

# ¿Qué filas DocPerm hay en la base?
ferris role-permissions list Task

# Crear/sobrescribir una regla (se aplica en el próximo arranque)
ferris role-permissions set Task "Projects User" --read --write --create
```

La ruta `/api/authz/role-permissions` recarga en caliente; el comando de CLI
escribe la misma tabla pero el servidor la lee al arrancar. No confundas una con
otra.

## Errores de validación útiles

```json
{ "error": "bad_request", "message": "required field missing: subject" }
{ "error": "bad_request", "message": "field due_date: invalid value" }
{ "error": "conflict", "message": "document already exists: Task/TASK.00001" }
{ "error": "conflict", "message": "document is submitted, cannot modify" }
{ "error": "not_found", "message": "doctype not found: Tasj" }
```

Un `409` por documento enviado no es un permiso: es el ciclo de vida. Para
editarlo hay que `cancel` y `amend`, no elevar privilegios.

:::tip[El 500 no se depura desde el cliente]
Si ves `{"error":"internal_error","message":"internal error"}`, el motivo está en
el log del servidor con el error completo. Sube el nivel de log
(`[logging] level`) y reproduce; adivinar por el código HTTP no lleva a ningún
sitio.
:::
