---
title: Métodos, JSON-RPC y GraphQL
description: Llama métodos registrados, usa JSON-RPC 2.0 y batch, y consulta DocTypes con el subconjunto de GraphQL que Ferris implementa.
---

Además del CRUD genérico, un DocType o una app pueden publicar **métodos**. Hay
cuatro puertas de entrada y conviene saber cuál usar antes de escribir código.

## `POST /api/method/{method}`

La forma directa: el cuerpo JSON se pasa como `params` y la respuesta es el valor
devuelto por el handler, sin envoltorio.

```bash
curl -s -b cookies.txt -X POST http://localhost:8000/api/method/files.list \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"limit":20,"search":"invoice"}'
```

La respuesta es un array de ficheros (`id`, `name`, `content_type`, `size`,
`created_at`, `url`). El tamaño de página por defecto es 100 si no mandas
`limit`, y `search` filtra por subcadena del nombre.

Un nombre desconocido responde `404` con `document not found: method/<name>`,
porque el registro reutiliza el error tipado de documento.

### Qué métodos existen

El registro es una **cadena ordenada por nombre**: una base del framework y,
encima, una entrada por app que la sobrescribe. La resolución es *last wins* y el
orden entre apps es el de su nombre, así que es determinista.

- **Bases del framework:** hoy solo `files.list` (montada cuando la feature
  `files` está compilada y el rol `api` activo). Es la que adapta
  `GET /api/files` y la que un app puede sobrescribir.
- **Apps WASM:** cada `describe().methods` se declara en el registro al cargar el
  plugin. Un método con `overrides: true` exige que el nombre ya exista y que la
  app tenga la capacidad `overrides`.

No hay un `ping` ni un `version` universales. Para descubrir qué hay montado en
tu proceso:

```bash
curl -s -b cookies.txt http://localhost:8000/api/openapi.json \
  | jq -r '.info.version, .["x-ferris-methods"][]'
```

`x-ferris-methods` es la lista ordenada de nombres registrados; además, el
documento genera una entrada `/api/method/<nombre>` por cada uno.

:::note[No inventes un método]
No existe un registro de métodos declarado en configuración ni un catálogo
estático en la documentación: la lista real sale del binario compilado y de los
plugins cargados. Si un método no aparece en `x-ferris-methods`, no está.
:::

### Herencia explícita

Una app que sobrescribe `files.list` puede llamar a la implementación de debajo
con `data::call-method` (el `super` explícito). El registro expone
`call_next(name, caller, params)`: si `caller` no tiene entrada en esa cadena, la
llamada se rechaza con `PermissionDenied`. **No hay fallback automático en caso
de error**: si el override falla, la llamada falla. Caer a la base convertiría
una app rota en una API silenciosamente distinta.

## JSON-RPC 2.0

```bash
curl -s -b cookies.txt -X POST http://localhost:8000/api/jsonrpc \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"jsonrpc":"2.0","method":"files.list","params":{"limit":5},"id":1}'
```

```json
{ "jsonrpc": "2.0", "result": [{ "id": "…", "name": "factura.pdf" }], "id": 1 }
```

Forma de la petición (`JsonRpcRequest`):

| Campo | Obligatorio | Notas |
|---|---|---|
| `method` | sí | Nombre registrado |
| `params` | no | Se pasa tal cual; ausente equivale a `null` |
| `id` | no | Se devuelve sin interpretar; puede ser número, string o null |
| `jsonrpc` | no | Se ignora en la entrada; la respuesta siempre dice `"2.0"` |

Códigos de error:

| Código | Significado | Origen |
|---|---|---|
| `-32601` | Method not found | `DocumentError::NotFound` |
| `-32602` | Invalid params | `ValidationError` |
| `-32603` | Internal error | Cualquier otro fallo |

El endpoint siempre responde `200`: el fallo va en el objeto `error`.

## Batch

```bash
curl -s -b cookies.txt -X POST http://localhost:8000/api/batch \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '[
    {"jsonrpc":"2.0","method":"files.list","params":{},"id":"a"},
    {"jsonrpc":"2.0","method":"no.existe","params":null,"id":"b"}
  ]'
```

El cuerpo es un **array** de peticiones y la respuesta es un array con **una
respuesta por entrada**, en el mismo orden. Un fallo no cancela el resto ni
cambia el estado HTTP. No es una transacción: cada método corre por separado.

## GraphQL

```bash
curl -s -b cookies.txt -X POST http://localhost:8000/api/graphql \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{
    "query": "query ($n: Int) { Task(limit: $n) { name subject status } }",
    "variables": { "n": 5 }
  }'
```

Ferris implementa un **subconjunto** de GraphQL, no el lenguaje completo:

- Cada campo raíz es el **nombre de un DocType** (`Task`, `SalesOrder` sin
  espacios no; el nombre es el del DocType y puede llevar espacios).
- Argumentos soportados: `name` (devuelve un documento), `limit`, `offset`.
- Alias de campo y `__typename` funcionan.
- `__schema` devuelve una introspección mínima: `queryType`, `mutationType:
  null`, `subscriptionType: null` y la lista de DocTypes con `kind: OBJECT`.
- `variables` debe ser un objeto JSON; cualquier otra cosa se trata como "sin
  variables".
- El campo `operation_name` se acepta pero **no se usa**: una operación por
  petición.

Lo que **no** hay: mutaciones, suscripciones, fragmentos con `... on`, filtros
por argumento, directivas ni introspección completa. Para escribir, usa REST.

La respuesta es siempre `200`. Si el documento entero no parsea, llega solo
`errors`; si un campo raíz falla, `data` trae `null` en esa clave y `errors` el
motivo con su `path`:

```json
{
  "data": { "Task": null },
  "errors": [{ "message": "permission denied: read on Task", "path": ["Task"] }]
}
```

Las lecturas pasan por `DocStore`, es decir, por las mismas comprobaciones de
permiso que el REST.

## Cuándo usar cada uno

| Necesidad | Usa |
|---|---|
| Leer o escribir un documento | [Recursos](/api/recursos/) (`/api/resource/…`) |
| Invocar una acción de negocio publicada | `/api/method/{method}` |
| Varias llamadas y una sola ida y vuelta | `/api/batch` (sin transacción) |
| Cliente que ya habla JSON-RPC | `/api/jsonrpc` |
| Traer un documento con una forma concreta | `/api/graphql` para lecturas simples |
| Agregados o filtros ricos | `POST /api/resource/{doctype}/list` |

:::caution[Batch no es transaccional]
`/api/batch` es un bucle sobre `dispatch`. Si la segunda entrada falla, la
primera ya se aplicó. Para atomicidad real, la app debe exponer **un** método que
haga el trabajo dentro de una transacción (`data::apply-ops` en el guest).
:::
