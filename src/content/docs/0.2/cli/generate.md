---
title: ferris generate
description: Los artefactos que genera la CLI —WIT, schema.json, tipos
  TypeScript y plantillas Typst—, dónde los escribe y qué no puede generar.
slug: 0.2/cli/generate
---

`ferris generate` escribe artefactos **derivados** en el proyecto. Cada
generador es real: no hay un “generado” que consista en no escribir nada.

```bash
ferris generate [-w WHAT] [-o OUT_DIR] [--force]
```

| Flag | Por defecto | Efecto |
|---|---|---|
| `-w`, `--what <WHAT>` | `all` | Qué generar: `all`, `schema`, `api`, `models`, `routes`, `typescript`, `wit`, `templates`. |
| `-o`, `--out-dir <DIR>` | `.` | Raíz donde se escriben las salidas. |
| `--force` | desactivado | Sobrescribe ficheros existentes. |

`--out-dir` es relativo al directorio del proyecto (el que fija `--dir`).

## Salidas por valor

| `--what` | Escribe | Fuente |
|---|---|---|
| `wit` | `<out>/wit/ferris.wit` | El WIT del framework. |
| `schema` | `<out>/config/schema.json` | El registro de DocTypes del proceso. |
| `typescript` | `<out>/web/src/types/generated.ts` | El mismo registro. |
| `templates` | `<out>/templates/print/<stem>.typ` | Las plantillas Typst incluidas. |
| `all` | `wit`, luego `templates`, `schema` y `typescript`. | — |

### `wit`

Copia `ferris-wasm/wit/ferris.wit` desde la raíz del framework. Si no la
encuentra, el error dice dónde buscó y sugiere `FERRIS_HOME`. Es la forma de
refrescar el contrato de un proyecto tras actualizar el framework; el fichero
generado debe seguir siendo idéntico al del framework, porque el invitado se
compila contra él.

### `schema`

Escribe un documento JSON con esta forma:

```json
{
  "format": "ferris-schema",
  "version": 1,
  "doctypes": []
}
```

Cada DocType incluye nombre, módulo, descripción, `naming_series`, workflow,
flags (`is_submittable`, `is_tree`, `is_single`, `is_child_table`,
`track_changes`, `allow_rename`, `allow_copy`, `allow_delete`, `allow_print`,
`allow_email`, `allow_attach`) y sus campos con `fieldname`, `label`,
`fieldtype`, `options`, `default`, `reqd`, `read_only`, `hidden`, `depends_on`,
`description`, `in_list_view`, `in_standard_filter`, `in_global_search`,
`unique`, `search_index`, `permlevel`, `print_hide` y `report_hide`.

### `typescript`

Escribe interfaces con los campos estándar (`name`, `owner`, `creation`,
`modified`, `modified_by`, `docstatus`) más los del DocType. El tipo se deduce del
fieldtype: `Check` → `boolean`; `Int`, `Float`, `Currency`, `Percent`, `Rating` y
`Duration` → `number`; `Table`, `JSON` y `Geolocation` →
`Record<string, unknown>`; el resto → `string`. Un campo obligatorio (`reqd`) no
lleva `?`.

### `templates`

Escribe una plantilla `.typ` por cada plantilla incluida en `ferris-print`
(`BUILTIN_TEMPLATES`) en `templates/print/`. Sin `--force` se niega a sobrescribir
en cuanto encuentra un fichero existente; las plantillas anteriores a esa en el
orden de la lista pueden haberse escrito ya.

### `api`, `models`, `routes`

Estos tres **no** se generan y el comando lo dice con un error explícito (el
texto nombra el valor pedido; este es el de `api`):

```text
Cannot generate API routes from the CLI. Ferris apps are WIT/WASM components:
doctypes are declared in the app (wit/ferris.wit) and registered inside the host
runtime at load time, so the CLI process has no doctype registry to generate
from.
```

Una app Ferris no tiene modelos Rust ni rutas que la CLI pueda derivar: el
DocType se declara en el descriptor del invitado y el host lo registra al cargar
el componente.

## El registro en el proceso de la CLI

`schema` y `typescript` leen el registro global de DocTypes. La CLI **no** carga
el catálogo del framework ni los DocTypes de las apps: eso ocurre al arrancar el
servidor (`serve`, `run`, `dev`) y en `doctor`. Si el registro está vacío, el
comando avisa (`doctype registry is empty in the CLI process…`) y escribe el
fichero igualmente, con la lista vacía y un comentario que lo explica.

Por eso estos dos generadores sirven para volcar lo que el proceso conoce, no
para descubrir la metadata de una app en marcha; para eso está la API de
metadatos del servidor.

## Ejemplos

```bash
# todo lo generable
ferris generate

# refrescar el contrato WIT tras actualizar el framework
ferris generate --what wit --force

# schema y tipos en una carpeta de artefactos
ferris generate --what schema --out-dir build/gen
ferris generate --what typescript --out-dir build/gen

# plantillas de impresión en el proyecto
ferris generate --what templates
```

::\:caution Sin `--force` no se sobrescribe
Cada salida comprueba su ruta antes de escribir. Un fichero existente produce
`<ruta> already exists. Pass --force to overwrite.` y deja el original intacto.
::\:

::\:tip WIT y contrato
`ferris generate --what wit` y el `wit/ferris.wit` que escribe `ferris new` salen
de la misma fuente. Si actualizas el framework, regenera el WIT y recompila la
app; el contrato es la frontera entre invitado y host. Ver
[el contrato WIT](/0.2/apps/wit/).
::\:
