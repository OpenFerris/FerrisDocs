---
title: Recursos
description: CRUD de documentos, listas con filtros y paginación, vecinos, ciclo
  de vida y Singles.
slug: 0.2/api/recursos
---

El motor de documentos se expone de forma genérica por DocType: la misma ruta
sirve para `Task`, `User` o cualquier DocType que una app declare. No hay una
ruta por tabla.

```text
GET/POST       /api/resource/{doctype}
POST           /api/resource/{doctype}/list
GET/PUT/DELETE /api/resource/{doctype}/{name}
GET            /api/resource/{doctype}/{name}/neighbors
POST           …/{name}/submit | /cancel | /amend | /rename
GET/PUT        /api/single/{doctype}
```

Los ejemplos de escritura asumen que ya extrajiste el token CSRF:

```bash
CSRF=$(awk 'tolower($1)=="x-csrf-token:"{print $2}' headers.txt | tr -d '\r')
```

## Crear

```bash
curl -s -b cookies.txt -X POST http://localhost:8000/api/resource/Task \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"subject":"Revisar el README","status":"Open"}'
```

Responde `201` con el documento, incluidos `name`, `owner`, `creation`,
`modified` y `docstatus`. Con naming series no mandes `name`; con
`naming_type = prompt` es obligatorio.

## Leer uno

```bash
curl -s -b cookies.txt http://localhost:8000/api/resource/Task/TASK.00001
```

Inexistente es `404`; sin permiso de lectura, `403` (no se enmascara como
`404`, igual que Frappe).

## Actualizar y borrar

```bash
curl -s -b cookies.txt -X PUT http://localhost:8000/api/resource/Task/TASK.00001 \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"status":"Done"}'

curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X DELETE \
  http://localhost:8000/api/resource/Task/TASK.00001 -H "X-CSRF-Token: $CSRF"
```

`PUT` responde `200` con el documento; `DELETE`, `204`. Un documento enviado
(`docstatus = 1`) es `409` (`Submitted`): no se edita ni se borra.

## Listar

### `GET /api/resource/{doctype}` (consulta simple)

La forma de query acepta estos parámetros (igualdad simple); la de `POST` es la
que usa el Desk.

| Parámetro | Tipo | Efecto |
|---|---|---|
| `filters` | mapa | Igualdad por campo, codificada en la query; para filtros reales usa `POST …/list` |
| `fields` | lista | Proyección de campos |
| `limit` | entero | Tamaño de página; por defecto 20, recortado a `1..=1000` |
| `offset` | entero | Desplazamiento |
| `order_by` | texto | Campo y dirección opcional: `modified desc` |
| `order` | `asc`/`desc` | Dirección cuando `order_by` no la trae |
| `search` | texto | Subcadena insensible a mayúsculas sobre los valores de texto |

```bash
curl -s -b cookies.txt \
  'http://localhost:8000/api/resource/Task?limit=10&order_by=due_date%20asc'
```

`order_by` acepta cualquier campo del documento. Los alias `created_at` y
`updated_at` se traducen a `creation` y `modified`; un blob se ordena en Rust.

### `POST /api/resource/{doctype}/list` (lista del Desk)

Es la ruta que usa la interfaz y la única con filtros estructurales y
`only_liked`.

```bash
curl -s -b cookies.txt -X POST \
  http://localhost:8000/api/resource/Task/list \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"limit_start":0,"limit_page_length":20,
       "filters":"[[\"status\",\"equals\",\"Open\",false]]",
       "order_by":"modified desc","search":"readme"}'
```

| Campo | Tipo | Notas |
|---|---|---|
| `limit_start` | entero | Offset; valores fuera de `u32` saturan |
| `limit_page_length` | entero | Por defecto **20**, recortado a `1..=1000` |
| `filters` | **string** JSON | Filas `[campo, op, valor, or?]` |
| `order_by` | texto | Igual que en la ruta GET |
| `search` | texto | Búsqueda por subcadena |
| `fields` | lista | Proyección; ausente = campos por defecto del DocType |
| `only_liked` | booleano | Solo documentos que el llamador ha marcado con like |

`filters` es una cadena que contiene JSON, no un array anidado: el motor la parsea
con `parse_list_filters`. Los operadores son `like`, `equals`, `in`, `gt`, `gte`,
`lt` y `lte`; uno desconocido cae a `equals`. El cuarto elemento, `or: true`,
**abre un nuevo grupo OR**: dentro de un grupo las filas se combinan con AND y los
grupos con OR. Un `or` en la primera fila no tiene grupo que cerrar y se ignora.

```json
[["status","equals","Open",false],["subject","like","readme",true]]
```

:::note[`filter_ops` no es un parámetro HTTP]
`filter_ops` es el tipo interno de filtros ya parseados. En la API solo existe
`filters` (cadena) o el objeto de igualdad del GET; enviarlo no hace nada.
:::

### Paginación

Ambas rutas devuelven el mismo sobre:

```json
{ "data": [], "total": 137, "limit": 20, "offset": 0, "page": 1, "page_size": 20 }
```

`page` es 1-based (`offset / limit + 1`). `total` cuenta los documentos **que el
llamador puede leer**: la lista aplica `Permission::Read` y descarta filas, así
que no revela registros ajenos.

## Vecinos

```bash
curl -s -b cookies.txt http://localhost:8000/api/resource/Task/TASK.00002/neighbors
```

```json
{ "prev": "TASK.00001", "next": "TASK.00003" }
```

Los extremos omiten su clave para deshabilitar el botón en vez de ofrecer un
enlace roto. Se resuelven por `name` y pasan por el mismo filtro que la lista.

## Ciclo de vida

```bash
# Enviar (Draft -> Submitted)
curl -s -b cookies.txt -X POST \
  http://localhost:8000/api/resource/Task/TASK.00001/submit \
  -H "X-CSRF-Token: $CSRF"

# Cancelar (Submitted -> Cancelled)
curl -s -b cookies.txt -X POST \
  http://localhost:8000/api/resource/Task/TASK.00001/cancel \
  -H "X-CSRF-Token: $CSRF"

# Enmendar (crea una copia en Draft, docstatus 0)
curl -s -b cookies.txt -X POST \
  http://localhost:8000/api/resource/Task/TASK.00001/amend \
  -H "X-CSRF-Token: $CSRF"

# Renombrar la clave primaria
curl -s -b cookies.txt -X POST \
  http://localhost:8000/api/resource/Task/TASK.00001/rename \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"new_name":"TASK.00042"}'
```

`submit`/`cancel` exigen que el DocType sea `is_submittable`; en uno
que no lo es, la transición falla. `rename` requiere `allow_rename` en el
metadato (`RenameNotAllowed`), y `new_name` viaja en el cuerpo: si falta, se usa
cadena vacía y la validación de nombre la rechaza.

## Singles

Un DocType `is_single` tiene un único documento, nombrado como el DocType.

```bash
curl -s -b cookies.txt http://localhost:8000/api/single/System%20Settings

curl -s -b cookies.txt -X PUT http://localhost:8000/api/single/System%20Settings \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"language":"es"}'
```

`POST /api/resource/{single}` y `DELETE /api/resource/{single}/{name}` responden
`405`: no hay un segundo documento que crear ni uno que borrar. Usa siempre
`/api/single/…`.

## Errores frecuentes en esta superficie

DocType o documento inexistente → `404`. Sin `read`/`write` → `403`. Nombre
inválido o cuerpo mal formado → `400`. Ya existe al crear, o documento enviado →
`409`. Un `filters` mal formado **no** es un error: las filas que no parsean se
descartan, así que el resultado es más amplio, no vacío.
