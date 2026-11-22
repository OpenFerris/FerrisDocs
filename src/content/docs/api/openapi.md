---
title: OpenAPI
description: Qué describe /api/openapi.json, qué queda fuera y cómo consumirlo sin engaños.
---

```bash
curl -s http://localhost:8000/api/openapi.json | jq
```

El documento se genera en cada petición a partir de la versión del paquete y de la
lista de métodos registrados. Es OpenAPI **3.0.3**.

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "Ferris API",
    "version": "0.3.0",
    "description": "Ferris REST, JSON-RPC and batch API."
  },
  "x-ferris-methods": ["files.list"],
  "paths": { "…": {} },
  "components": { "schemas": { "…": {} } }
}
```

## Qué cubre

`paths` contiene:

| Ruta | Operaciones |
|---|---|
| `/api/resource/{doctype}` | `get` (lista), `post` (crear) |
| `/api/resource/{doctype}/{name}` | `get`, `put`, `delete` |
| `/api/method/{method}` | `post` |
| `/api/method/<nombre>` | Un `post` concreto por cada método registrado |
| `/api/jsonrpc` | `post` |
| `/api/batch` | `post` |
| `/api/graphql` | `post` |
| `/api/openapi.json` | `get` |

`components.schemas` define:

| Esquema | Contenido |
|---|---|
| `Document` | `type: object`, `additionalProperties: true` — cualquier documento |
| `ListResponse` | `data`, `total`, `limit`, `offset` |
| `Error` | `error`, `message` |
| `JsonRpcRequest` | `jsonrpc`, `method` (requerido), `params`, `id` |
| `JsonRpcResponse` | `jsonrpc`, `result`, `error`, `id` |
| `GraphQlRequest` | `query` (requerido), `variables`, `operationName` |
| `GraphQlResponse` | `data`, `errors` |

`x-ferris-methods` es la extensión de vendor con los nombres ordenados que acepta
`/api/method/{method}` en **este** proceso. Es lo único que te dice qué hay
montado de verdad.

## Qué NO cubre

Es genérico por necesidad: los DocTypes son dinámicos. Fuera del
documento quedan:

- **Todas las rutas de autenticación**: `/api/auth/login`, `/session`,
  `/logout`, `/mfa/*`, `/api/oauth/*`.
- **`POST /api/resource/{doctype}/list`**, la lista real del Desk: el spec solo
  declara el `GET` genérico. Si integras contra el spec, no verás los filtros
  estructurales ni `only_liked`.
- Ciclo de vida (`submit`, `cancel`, `amend`, `rename`), `neighbors` y los
  Singles (`/api/single/{doctype}`).
- Metadatos (`/api/doctype/*`), permisos (`/api/authz/*`), personalización,
  engagement, actividad, desired-state, notificaciones, dashboards, widgets,
  impresión e informes.
- **Esquemas de seguridad**: no hay `components.securitySchemes` ni requisitos
  `security`. La cookie `ferris_session` y la cabecera `X-CSRF-Token` no se
  describen.
- **Campos de cada DocType**: un `Document` es un objeto abierto. Los campos
  concretos salen de `GET /api/doctype/meta/{doctype}`.

:::caution[Una discrepancia conocida]
El esquema `GraphQlRequest` documenta `operationName`, pero el handler
deserializa `operation_name` (y lo ignora). Si generas un cliente desde el spec,
envía `operation_name` o simplemente omítelo.
:::

## Cómo consumirlo

### Generar un cliente

```bash
curl -s http://localhost:8000/api/openapi.json > openapi.json
npx @openapitools/openapi-generator-cli generate \
  -i openapi.json -g rust -o client/
```

Como los recursos son genéricos, el cliente que salga tendrá métodos con
`doctype` y `name` como parámetros. Para tipar por DocType, genera un cliente por
DocType a partir de la metadata o escribe un wrapper.

### Validar contra un servidor

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:8000/api/resource/Task
```

El spec no incluye `servers`; añade la base URL tú (`http://localhost:8000`, o
la de `[server] external_url` en producción).

### Descubrir métodos

```bash
curl -s http://localhost:8000/api/openapi.json \
  | jq -r '.["x-ferris-methods"][]'
```

## Introspección de GraphQL

No hay un endpoint de introspección estándar. El subconjunto que Ferris
implementa responde a `__schema` dentro de una consulta normal:

```bash
curl -s -b cookies.txt -X POST http://localhost:8000/api/graphql \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"query":"{ __schema { queryType { name } types { name kind } } }"}'
```

Devuelve `queryType.name = "Query"`, `mutationType: null`,
`subscriptionType: null` y la lista de DocTypes con `kind: "OBJECT"`. No incluye
campos, argumentos, tipos de entrada ni directivas. Para el modelo real de un
DocType, usa `/api/doctype/meta/{doctype}`.

:::tip[El spec es el contrato mínimo, no la documentación completa]
Úsalo para saber si un endpoint existe y con qué forma básica, y esta sección de
[API HTTP](/api/) para lo que el spec calla: sesión, CSRF, filtros y rutas de
metadatos.
:::
