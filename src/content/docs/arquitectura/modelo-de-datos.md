---
title: Modelo de datos
description: Cómo se guarda un documento en la base de datos, qué es la metadata compilada y qué se indexa de verdad.
---

Ferris guarda cada DocType en una tabla propia con **columnas fijas** y un blob
JSON. No hay una columna por campo: el esquema físico es idéntico para un DocType
compilado con `#[doctype]`, uno declarado por un plugin y uno ampliado con custom
fields. Esa uniformidad es lo que permite añadir un campo sin una migración de
columna y tratar igual todas las fuentes de metadata.

## La tabla: `tab<DocType>`

`ferris_schema::migration::document_table` es la única función que deriva el
nombre:

```rust
// ferris-schema/src/migration/schema.rs
let name: String = doctype.chars().filter(|c| !c.is_whitespace()).collect();
let table = Ident::new(&format!("tab{name}"))?;
```

Consecuencias:

- `ToDo` → `tabToDo`, y `To Do` → `tabToDo` (mismo destino, sin espacios).
- El nombre debe ser ASCII alfanumérico o `_`; cualquier otra cosa es
  `ValidationError::Invalid`.
- El resultado pasa por `Ident::new`, que lo valida y lo cita por dialecto. El
  motor, la migración y el `ensure_table` llaman a esta misma función, así que
  citan el nombre igual y no crean dos tablas distintas en PostgreSQL.

El DocType `Document Naming Rule` es un buen recordatorio: su tabla es
`tabDocumentNamingRule`, no `tabDocument Naming Rule`.

## Columnas estándar

`ferris_schema::migration::document_columns()` define exactamente seis:

| Columna | Tipo | Notas |
|---|---|---|
| `name` | `VARCHAR(255)` | Clave primaria. Es el nombre del documento. |
| `owner` | `VARCHAR(255)` | Nullable. Dueño resuelto de la sesión, nunca del body. |
| `docstatus` | `SMALLINT` | `NOT NULL DEFAULT 0`. |
| `creation` | `BIGINT` | `NOT NULL`. Timestamp Unix. |
| `modified` | `BIGINT` | `NOT NULL`. Timestamp Unix. |
| `data` | `TEXT` | `NOT NULL`. El documento completo en JSON. |

`owner`, `docstatus`, `creation` y `modified` se **duplican** fuera del blob porque
son las columnas por las que se ordena y filtra. El resto de campos vive solo en
`data`.

## El blob JSON

`data` es el documento serializado con **claves ordenadas**. El motor lo escribe
siempre a través de `canonical_blob`:

```rust
let canonical: serde_json::Value = serde_json::to_value(document)?;
serde_json::to_string(&canonical)
```

`ferris_core::Value::Object` es un `HashMap`, cuyo orden de iteración no es
estable; `serde_json::Value` usa un `BTreeMap` internamente, así que pasar por él
produce la misma cadena siempre. Esto importa porque el plugin recibe el
documento como texto y compara byte a byte con lo que lee después; con un orden
inestable la comparación fallaría aunque el contenido fuera idéntico.

Dentro del blob:

- `docstatus` aparece como palabra (`"draft"`, `"submitted"`, `"cancelled"`)
  mientras la columna guarda el entero. Ambos se escriben desde el mismo valor
  para que no puedan discrepar.
- `creation` y `modified` aparecen también como RFC 3339, además del `BIGINT`.
- `owner`, `name`, `modified_by` viven en el blob igualmente.

## Child tables dentro del blob

Un campo `Table` no crea una tabla hija. El valor es un **array de objetos** dentro
del documento del padre:

```json
{
  "name": "INV-0001",
  "items": [
    { "item_code": "A", "qty": 2, "idx": 1 },
    { "item_code": "B", "qty": 1, "idx": 2 }
  ]
}
```

El DocType hijo se declara con `is_child_table` y el tipo que genera `#[doctype]`
implementa `ChildDocument` (`parent`, `parentfield`, `parenttype`, `idx`), que es
la convención de Frappe. El **motor no inyecta** esas claves: guarda el array tal
como llega. Si tu modelo las necesita para enlazar filas con el padre, las escribe
tu código o un hook.

Un Child DocType **nunca** sigue Document Naming Rules: se direcciona por su fila
padre, y un contador global filtraría nombres entre padres distintos.

La contrapartida es explícita: los campos de una child table no están indexados, y
las Connections que viven dentro de una child table se resuelven escaneando el
array en Rust, con un tope duro de filas por página.

## Metadata compilada vs contrato de cable

Son dos tipos distintos a propósito.

**`ferris_schema::DoctypeMeta` / `FieldMeta`** es la metadata real: la que usa el
motor para validar, nombrar y autorizar. Tiene más de cien propiedades de DocType y
casi cincuenta de campo, y no se serializa al navegador tal cual.

**`ferris_schema::contract::DynMeta` / `DynField`** es el subconjunto que el Desk
renderiza. Se produce con `DynMeta::from_serde_meta(&meta)`, que pasa por JSON: si
el espejo se desvía del endpoint, falla en SSR y no en el navegador de un usuario.

```text
registro (DoctypeMeta)  ──aplicar customización──▶  efectiva  ──DynMeta::from_serde_meta──▶  /api/doctype/meta/{doctype}
```

Regla práctica: **añadir** un campo a `DynMeta` es seguro (todo lo opcional tiene
`#[serde(default)]`); renombrar o cambiar el tipo de uno existente rompe a todos
los Desk ya desplegados.

## Single, Child y Virtual en disco

| Clase | Tabla | Nombre | Lista |
|---|---|---|---|
| Normal | `tab<DocType>` | por naming | sí |
| Single | `tab<DocType>` con una sola fila | el nombre del DocType | no |
| Child | ninguna propia | el padre | no |
| Virtual | ninguna | lo decide el provider | la decide el provider |

Un **Single** se materializa de forma perezosa en la primera lectura
(`get_single`), aplicando los `default` declarados a las claves que el llamante no
envió. Crear su fila corre a cargo del framework, así que se salta
`Permission::Create`; leerla y escribirla sí se autorizan con normalidad y no
tienen atajo de owner.

Un **Virtual** no tiene fila: `is_virtual` desvía toda la operación a su
`VirtualDoctypeProvider`, que posee el almacenamiento y los identificadores.

## Índices

Toda tabla recibe tres índices por defecto:

```rust
("idx_owner",    &["owner"],    false),
("idx_modified", &["modified"], false),
("idx_docstatus",&["docstatus"],false),
```

Los índices declarados en `meta.indexes` se clasifican con
`ferris_schema::migration::classify_index` en tres casos:

- `DeclaredIndex::Columns` — todos los campos nombrados son columnas reales: se
  crea un índice normal.
- `DeclaredIndex::JsonField(field)` — un único campo sin columna: se crea un
  índice de expresión JSON, y la lista empuja filtros `=`/`IN` sobre ese mismo
  campo.
- `DeclaredIndex::Unsupported` — compuesto con campos sin columna: se omite. No
  hay forma portable (MySQL necesitaría una columna generada por campo), y se
  prefiere no fingir que existe.

La regla de oro: un filtro solo se empuja a SQL si el índice se creó, porque ambos
salen de la misma clasificación.

## Migraciones

`ferris_schema::migration::MigrationRunner::add_schema_migrations` genera **una
migración por DocType registrado**, con un `up_sql` construido a partir de la
misma definición de tabla que usa el motor.

La versión se deriva **solo del nombre** del DocType: FNV-1a de 32 bits plegado en
el rango por encima de `1_000_000` (reservado para migraciones escritas a mano) y
por debajo de `u32::MAX`. Así, registrar o eliminar otro DocType no desplaza las
versiones existentes ni invalida los checksums ya aplicados.

Dos DocTypes con la misma versión no se ignoran: el runner compara las versiones
ordenadas y falla nombrando ambos, porque el registro "ya aplicado" se comería la
segunda tabla en silencio.

`ferris migrate` ejecuta el runner; además, el motor crea la tabla de forma
perezosa (`ensure_table`) en la primera escritura, de modo que una base sin migrar
sigue funcionando. Las dos rutas comparten `document_columns`, que es lo que impide
que vuelvan a divergir.

:::note[Sin columnas por campo]
Que los campos vivan en `data` significa que no se pueden indexar como columnas. Es
el precio de que un DocType compilado y uno ampliado con custom fields tengan
exactamente el mismo esquema. Los índices de expresión JSON son la respuesta para
los campos que de verdad se filtran.
:::
