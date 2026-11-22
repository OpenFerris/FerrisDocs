---
title: Documentos
description: Leer, escribir, listar, contar y agregar documentos desde una app o por HTTP, con permisos del usuario y errores tipados.
---

Hay dos caminos al mismo almacén de documentos: la interfaz WIT `data` desde la
app, y `/api/resource/<doctype>` por HTTP. Ambos autorizan **como el usuario que
actúa**: la capacidad de la app decide si puede llamar, y el host decide después
qué filas ve ese usuario. Las dos comprobaciones son independientes.

:::note[Una app no es un administrador]
Tener `docstore-write` no salta los permisos. Una lectura que el usuario no puede
hacer devuelve `permission-denied` aunque la app tenga la capacidad. Si la
petición no trae sesión, la app actúa como invitado anónimo.
:::

## El documento en el límite

```wit
record doc {
    name: string,
    doctype: string,
    owner: string,
    docstatus: string,   // "draft" | "submitted" | "cancelled"
    data: string,        // el cuerpo en JSON
}
```

`data` es JSON, no un tipo generado por DocType: el límite es estable aunque el
DocType añada campos.

## Leer: listar y filtrar

Una `query` lleva `filters`, `order-by`, `limit`, `offset` y `fields`; un
`filter` es un `field`, un `op` y un `value`.

Operadores: `eq`, `ne`, `like` (subcadena, sin distinguir mayúsculas), `in`
(`"a,b,c"`), `gt`, `gte`, `lt`, `lte`, `between` (`"bajo,alto"`). Los filtros se
combinan con **AND**.

```text
filas = data::list-docs("Nota", {
    filters: [{ field: "titulo", op: like, value: "informe" }],
    order-by: [{ field: "titulo", desc: false }],
    limit: 20,
    offset: 0,
    fields: ["name", "titulo"],
})
```

`eq` se resuelve con el índice del host; el resto se aplica en la consulta, así
que la paginación sigue siendo honesta. `fields` proyecta el JSON; los campos de
sistema (`name`, `owner`, `docstatus`) siempre vienen. Superar el tope de escaneo
del host es `validation-failed`, nunca un total truncado.

### Por nombre, en lote

```text
docs = data::get-docs("Nota", ["N-1", "N-2"])
```

El resultado es **posicional**: la entrada *i* es el documento `names[i]`, o
`none` si esa fila no existe. Una fila ausente **no es un error**; si necesitas
rigor, convierte el `none` en `not-found` tú mismo. No hay `get` individual: esto
es ambos.

## Contar y agregar sin traer filas

```text
total = data::count-docs("Nota", { filters: [...] })
```

`count-docs` empuja predicados y cuenta en la base cuando los campos están
indexados; `limit`, `offset` y `fields` se ignoran.

Un `aggregate-spec` es `fn` (`count`, `sum`, `avg`, `min`, `max`), `field` y un
`alias` opcional.

```text
filas = data::aggregate-docs("Nota", query, ["estado"], [
    { fn: count, field: "", alias: "total" },
])
```

`group-by` vacío devuelve **una** fila de total general. Los números llegan en
forma decimal canónica y cada valor se nombra con `alias` o con
`"<fn>_<field>"` (`count` si no hay campo).

## Escribir

```wit
record write {
    kind: op-kind,
    doctype: string,
    name: option<string>,
    data: option<string>,
    disposition: write-disposition,
}
```

| `kind` | Comportamiento |
|---|---|
| `create` | inserta; un nombre existente es `conflict` |
| `update` | actualiza; un nombre ausente es `not-found` |
| `upsert` | crea o actualiza por el `name` del cuerpo, idempotente |
| `delete` | borra y devuelve `none` |

`name` lo exigen `update` y `delete`; `create` y `upsert` lo toman del cuerpo.
`data` se ignora en `delete`.

```text
creado = data::write-doc({
    kind: create,
    doctype: "Nota",
    name: none,
    data: "{\"titulo\":\"Primera\"}",
    disposition: emit-events,
})
```

`data` lleva el cuerpo del documento en JSON; constrúyelo con los campos que el
DocType declara.

### Lotes como una transacción

```text
resultados = data::apply-ops([create, update, delete])
```

Aplica el lote como **una transacción**: si una operación falla (validación,
autorización, conflicto, fila ausente), todo el lote revierte. El resultado es
posicional y `none` para un `delete`. Es el único primitivo de lote: un alta
masiva es un lote de `create`.

### Naming

```text
nombre = data::next-name("NOTA-.-YYYY-MM-####")
```

Requiere `docstore-write`: una serie **asigna**, no lee. No escribas series a
mano; dos peticiones concurrentes producirían el mismo nombre.

### Escribir sin bucle

`disposition: silent` persiste y sella la fila sin reentrar en los handlers de
**esta** app, sin desactivar los de otras ni los del host. Es la forma de
reaccionar a un documento propio sin llamarte a ti mismo. Ver
[ciclo de vida](/apps/ciclo-de-vida/).

## Metadatos

`data::get-doctype("<doctype>")` devuelve `name`, los campos con `fieldtype`,
`label`, `required`, `read-only` y `options`, y los flags `is-submittable`,
`is-child-table` e `is-single`. `data::list-doctypes()` enumera los nombres.
Requiere `schema` (primordial). Úsalo para construir formularios o validar
opciones sin duplicar el esquema en tu código.

## Por HTTP

```http
POST /api/resource/Nota
Content-Type: application/json

{ "titulo": "Primera", "cuerpo": "hola" }
```

```http
POST /api/resource/Nota/list
Content-Type: application/json

{
  "limit_start": 0,
  "limit_page_length": 20,
  "filters": "[{\"field\":\"titulo\",\"op\":\"like\",\"value\":\"informe\"}]",
  "order_by": "titulo asc",
  "search": "",
  "fields": ["name", "titulo"]
}
```

`filters` es una **cadena** con el JSON del array (así lo envía el Desk). La
respuesta es el sobre común:

```json
{ "data": [ { "name": "N-1", "titulo": "Informe" } ], "total": 1, "page": 1, "page_size": 20 }
```

`total` sale de un `count` real, no de la página. `only_liked: true` filtra por
los documentos que el llamante ha marcado, resuelto antes de paginar para que
`total` siga siendo correcto.

| Ruta | Efecto |
|---|---|
| `GET /api/resource/<doctype>/<name>` | lee un documento |
| `PUT` / `DELETE` en la misma | actualiza / borra |
| `POST …/<name>/submit` | borrador → enviado |
| `POST …/<name>/cancel` | enviado → cancelado |
| `POST …/<name>/amend` | cancelado → borrador |
| `POST …/<name>/rename` | renombra |
| `GET …/<name>/neighbors` | anterior y siguiente en el orden de lista |
| `GET` / `PUT /api/single/<doctype>` | DocType `is-single` |

## Errores

| Situación | Variante | HTTP |
|---|---|---|
| fila inexistente | `not-found` | 404 |
| sin permiso (usuario o capacidad) | `permission-denied` | 403 |
| validación de campo | `validation-failed` | 422 |
| nombre duplicado | `conflict` | 409 |
| demasiadas peticiones | `rate-limited(s)` | 429 |
| plazo agotado | `timeout` | 504 |
| fallo del host | `internal` | 500 |

:::caution[No parsees mensajes]
Ramifica sobre el variante. El texto es para el operador, no para la lógica: un
mensaje de validación puede cambiar sin que cambie el contrato.
:::

## Buenas prácticas

- Filtra en la consulta, no en memoria: `count-docs` y `aggregate-docs` existen
  para no traer N filas.
- Pagina siempre con `limit`/`offset`; un listado sin límite depende del tope del
  host.
- Para reacciones en cadena, `silent` en la escritura propia y un job para el
  trabajo largo.
- No leas un DocType entero para comprobar si existe una fila: `get-docs` con un
  nombre y un `none` es suficiente.
