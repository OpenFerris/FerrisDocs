---
title: Informes e impresión
description: Query Reports (run, export, prepare) y Print Formats con plantillas Jinja/Typst y salida PDF, SVG, PNG o HTML, con sus permisos y límites.
---

Dos verticales distintos que suelen confundirse:

- **Report** ejecuta una consulta SQL parametrizada y devuelve filas;
- **Print** renderiza **un documento** con una plantilla (Typst) y devuelve un
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

## Print: un documento, un formato

Un **`Print Format`** es la unidad que renderiza el motor. Referencia el DocType
que imprime y lleva todo lo demás en la misma fila:

| Campo | Significado |
|---|---|
| `format_name` | nombre legible del formato |
| `doc_type` | DocType al que se aplica (`Link` a `DocType`) |
| `engine` | `Jinja` o `Typst` |
| `template` | fuente del formato en el lenguaje del motor |
| `template_dir` | subcarpeta relativa de la raíz `FERRIS_PRINT_TEMPLATE_DIR` para includes/extends |
| `parameters` | objeto JSON con valores por defecto para `params` |
| `sample_data` | documento de ejemplo para la vista previa |
| `paper_size`, `orientation`, `scale` | geometría de página |
| `margin_top/bottom/left/right` | márgenes en milímetros |
| `enabled` | si el formato se ofrece |

`Print Settings` (Single) es el fallback de instalación para `paper_size`,
`orientation` y `scale`; los valores de la fila ganan.

### Los dos motores terminan en Typst

```text
Jinja → MiniJinja → fuente Typst ─┐
Typst ───────────────────────────┴→ tipografía → PDF/SVG/PNG/HTML
```

`Typst` compila la plantilla tal cual. `Jinja` la pasa primero por MiniJinja: la
plantilla es **Typst con expresiones Jinja**, así que el usuario puede usar
`{% for %}`, `{% if %}`, macros, herencia (`{% extends %}`/`{% include %}`) y
filtros, sin aprender un AST propietario.

```jinja
#set page(width: 120mm, height: 90mm)
#set text(size: 9pt)
#text(size: 15pt)[Factura {{ doc.number | typst }}]

{% for item in doc.items %}
{{ item.name | typst }} — {{ item.qty }} × {{ item.rate | money }}
{% endfor %}

#text(size: 12pt)[Total: {{ params.total | money }}]
```

### Includes, extends y carpetas de plantilla

El servidor fija una **raíz de plantillas** con `FERRIS_PRINT_TEMPLATE_DIR`. Si
la variable no existe y el directorio `templates/print` está presente, se usa
ese. La raíz nunca se toma del usuario ni del directorio de trabajo de una
petición.

El campo `template_dir` de `Print Format` es una **subcarpeta relativa** dentro
de esa raíz. Ahí viven tanto los parciales de Jinja como los ficheros que Typst
lee con `read()`:

```text
templates/print/
└── invoice/
    ├── base.typ
    ├── line.typ
    └── ...
```

```jinja
{# invoice/base.typ #}
#set text(size: 11pt)
{% block body %}{% endblock %}
```

```jinja
{# Print Format: template_dir = "invoice" #}
{% extends "base.typ" %}
{% block body %}
  {% include "line.typ" %}
  Total: {{ params.total | money }}
{% endblock %}
```

Las rutas son relativas, no se admite `/`, `..` ni un enlace simbólico que salga
de la raíz; una carpeta insegura o inexistente es un `validation-failed`. Sin
raíz configurada, una plantilla que pida `template_dir` o use un include falla
con un error que dice que falta `FERRIS_PRINT_TEMPLATE_DIR`.

### Métodos base

La app puede sustituir el comportamiento de impresión declarando un método con
`overrides = true`; el host registra estas bases:

| Método | Para qué |
|---|---|
| `print.render` | renderiza un documento con un `Print Format` |
| `print.preview` | renderiza una plantilla guardada o inline con datos de muestra |
| `print.formats.list` | lista los formatos de un DocType |
| `print.format.save` | crea o actualiza una fila `Print Format` |

`print.render` y `print.preview` devuelven el binario en base64:

```json
{
  "format": "pdf",
  "content_type": "application/pdf",
  "extension": "pdf",
  "size": 12345,
  "bytes_base64": "JVBERi0xLjQK..."
}
```

El llamante se toma del **usuario ambiente** de la petición, nunca de los
parámetros. Una app que declare `print.render` puede llamar a la base con
`data::call-method("print.render", params)` (el `super` explícito).

### Contexto de la plantilla

| Variable | Contenido |
|---|---|
| `doc` / `document` | el documento completo |
| `params` | `parameters` del formato, con los `params` de la petición encima |
| `meta` | metadatos del DocType, cuando el llamante los tiene |
| `user` | usuario que pide la impresión |
| `now`, `today`, `now_unix` | fecha/hora del render |
| `format` | `name`, `doctype`, `engine`, `description` |

Filtros disponibles: `typst` (escapa markup), `typst_str` (literal de cadena),
`typst_value` (literal de código, para arrays/objetos), `date`/`datetime`,
`money`, `number`, `percent` y `json`.

:::caution[Escapa siempre el texto del documento]
La plantilla es Typst. Un `#`, `*`, `[` o `$` dentro de un campo cambia el
significado del documento o rompe la compilación. Usa `{{ doc.campo | typst }}`
para texto, `| typst_str` dentro de una cadena y `| typst_value` para construir
código.
:::

### Renderizar

```http
POST /api/print/Nota/N-1
Content-Type: application/json

{
  "format": "pdf",
  "print_format": "Carta",
  "paper_size": "a4",
  "orientation": "portrait",
  "scale": 1.0,
  "watermark": "BORRADOR",
  "params": { "total": 27.5 }
}
```

| `format` | Salida |
|---|---|
| `pdf` (por defecto) | documento PDF |
| `svg` | vector |
| `png` | imagen |
| `html` | HTML renderizado |

`paper_size`, `margins`, `orientation`, `scale`, `watermark`, `format` y `params`
se aplican. `margins` es `{ "top": 20, "bottom": 20, "left": 20, "right": 20 }`
en milímetros.

`GET /api/print/formats/{doctype}` lista los formatos del DocType más `builtin`,
la tabla genérica que se usa cuando no hay ninguno habilitado. Cada entrada
incluye `engine`, `parameters`, `sample_data` y `valid`; una fila malformada se
lista con `valid: false` y su `error` en vez de romper la lista.

### Vista previa

```http
POST /api/print/preview/Nota
Content-Type: application/json

{
  "format": "html",
  "template": "#text[{{ doc.titulo | typst }}]",
  "engine": "jinja",
  "data": { "titulo": "Borrador" },
  "params": { "sufijo": "!" }
}
```

También acepta `print_format` en lugar de `template`/`engine`; en ese caso usa
el `sample_data` de la fila si no se envía `data`. `template` y `print_format`
son mutuamente excluyentes. No lee ningún documento: el gate es el permiso
`print` **del DocType**.

### Permisos

El render de un documento usa `Permission::Print` **sobre el documento**, no
`Read`. Un usuario que puede ver una nota no puede automáticamente producir una
copia imprimible.

La fila `Print Format` se lee con contexto de sistema: una plantilla es una
definición de layout, no datos por usuario. Exigir `Read` sobre `Print Format`
convertiría imprimir en una operación de administrador.

### Límites

Una plantilla es editable desde el Desk, así que el motor la trata como entrada
no confiable:

| Límite | Valor por defecto |
|---|---|
| tamaño de la plantilla | 256 KiB |
| tamaño de la fuente Typst generada | 4 MiB |
| fuel de MiniJinja | 20 000 000 |
| recursión de MiniJinja | 100 |

Superarlos es un `validation-failed`, nunca un render a medias. Los valores se
pueden cambiar construyendo `PrintEngine` con otro `PrintConfig`/`TemplateLimits`;
el servidor usa los de por defecto.

:::note[Typst es síncrono]
El render corre en `spawn_blocking`. Un formato muy pesado ocupa un hilo de
bloqueo durante toda la generación; no lo uses como motor de informes masivos.
Para lotes, encola un job por documento.
:::

## Feature gates

| Vertical | Rutas |
|---|---|
| `report` | `/api/report`, `/api/report/{name}/run`, `/export`, `/prepare` |
| `print` | `/api/print/{doctype}/{name}`, `/api/print/formats/{doctype}`, `/api/print/preview/{doctype}` |

Sin el feature, las rutas no existen. Con `[features] print = true` en un binario
sin `print`, el arranque falla diciendo qué recompilar.

## Checklist

- [ ] `report`/`print` compilados y activados en `[features]`.
- [ ] El `Report` declara `ref_doctype` y el llamante tiene `Report` sobre él.
- [ ] Los placeholders de la SQL coinciden con los filtros que envía el cliente.
- [ ] El DocType tiene una `Print Format` habilitada, o se acepta `builtin`.
- [ ] El formato referencia el `doc_type` correcto y declara `engine` y `template`.
- [ ] El texto del documento se escapa con `| typst` (o `| typst_str`).
- [ ] Para volúmenes, un job por documento en lugar de una petición gigante.
