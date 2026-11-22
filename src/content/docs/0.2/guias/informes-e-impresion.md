---
title: Informes e impresión
description: Query Reports (run, export, prepare) y Print Formats con salida
  PDF, SVG, PNG o HTML, con sus permisos y límites.
slug: 0.2/guias/informes-e-impresion
---

Dos verticales distintos que suelen confundirse:

* **Report** ejecuta una consulta SQL parametrizada y devuelve filas;
* **Print** renderiza **un documento** con una plantilla (Typst) y devuelve un
  fichero.

## Report: consulta guardada

Un `Report` es una fila con SQL y su DocType de origen:

```json
{
  "name": "Notas abiertas",
  "ref_doctype": "Nota",
  "query": "SELECT name, titulo FROM tab_nota WHERE estado = :estado"
}
```

Los **filtros se derivan de los placeholders**: `:estado` se convierte en el
filtro `estado`. Un cliente solo puede pasar las claves que el SQL declara; una
clave no declarada es 400. Los valores siempre van **bindeados**, nunca
interpolados.

### Ejecutar

```http
POST /api/report/Notas%20abiertas/run
Content-Type: application/json

{ "filters": { "estado": "abierta" } }
```

La respuesta trae columnas y filas; `columns` se construye con los placeholders y
el tipo declarado.

### Exportar

```http
GET /api/report/Notas%20abiertas/export?format=csv&filters=%7B%22estado%22%3A%22abierta%22%7D
```

| `format` | Salida |
|---|---|
| `csv` (por defecto) | texto separado por comas |
| `tsv` | tabuladores |
| `md` / `markdown` | tabla Markdown |
| `html` | tabla HTML |
| `json` | filas serializadas |

`filters` viaja como un **único parámetro** con JSON codificado en URL.

### Preparar: no implementado

```http
POST /api/report/Notas%20abiertas/prepare
```

```json
{
  "error": "not_implemented",
  "message": "prepared reports need an asynchronous job queue; use /run or /export"
}
```

Responde **501 Not Implemented** a propósito. El motor es síncrono y la máquina
de estados de `Prepared Report` no existe; fingir que se encoló un job sería el
tipo de éxito silencioso que este proyecto prohíbe. Usa `/run` o `/export`.

### Permisos

Se comprueba dos veces:

1. el llamante necesita `Read` sobre la fila `Report`;
2. necesita `Report` sobre el `ref_doctype` declarado.

El motor recibe además un guard de lectura para ese DocType, así que un report
cuya SQL consulte otra tabla sigue siendo rechazado: la declaración no es
decorativa.

:::danger[Un Report es SQL del administrador]
Solo un admin debería crear filas `Report`. La validación protege al llamante, no
convierte la SQL en segura: una consulta mal escrita puede ser costosa. Trátala
como código.
:::

## Print: un documento, una plantilla

```http
POST /api/print/Nota/N-1
Content-Type: application/json

{
  "format": "pdf",
  "print_format": "Carta",
  "paper_size": "a4",
  "orientation": "portrait",
  "scale": 1.0,
  "watermark": "BORRADOR"
}
```

| `format` | Salida |
|---|---|
| `pdf` (por defecto) | documento PDF |
| `svg` | vector |
| `png` | imagen |
| `html` | HTML renderizado |

`GET /api/print/formats/{doctype}` lista las plantillas disponibles más
`builtin`, la genérica que se usa cuando el DocType no tiene ninguna habilitada.

### Permisos

El gate es `Permission::Print` **sobre el documento**, no `Read`. Un usuario que
puede ver una nota no puede automáticamente producir una copia imprimible.

La fila `Print Format` se lee con contexto de sistema: una plantilla es una
definición de layout, no datos por usuario. Exigir `Read` sobre `Print Format`
convertiría imprimir en una operación de administrador.

### Opciones: se aplican o se rechazan

`paper_size`, `margins`, `orientation`, `scale`, `watermark` y `format` llegan al
fuente Typst. En cambio:

```text
copies, duplex, color = false, page_range, letter_head, metadata, style
```

se rechazan con un `validation-failed` (422). No se aceptan y se ignoran: una
opción que el motor no honra es un fallo, no un detalle.

:::note[Typst es síncrono]
El render corre en `spawn_blocking`. Un formato muy pesado ocupa un hilo de
bloqueo durante toda la generación; no lo uses como motor de informes masivos.
Para lotes, encola un job por documento.
:::

## Feature gates

| Vertical | Rutas |
|---|---|
| `report` | `/api/report`, `/api/report/{name}/run`, `/export`, `/prepare` |
| `print` | `/api/print/{doctype}/{name}`, `/api/print/formats/{doctype}` |

Sin el feature, las rutas no existen. Con `[features] print = true` en un binario
sin `print`, el arranque falla diciendo qué recompilar.

## Checklist

* \[ ] `report`/`print` compilados y activados en `[features]`.
* \[ ] El `Report` declara `ref_doctype` y el llamante tiene `Report` sobre él.
* \[ ] Los placeholders de la SQL coinciden con los filtros que envía el cliente.
* \[ ] El DocType tiene una `Print Format` habilitada, o se acepta `builtin`.
* \[ ] No se piden opciones no soportadas (`copies`, `duplex`, …).
* \[ ] Para volúmenes, un job por documento en lugar de una petición gigante.
