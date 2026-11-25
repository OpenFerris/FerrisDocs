---
title: Modelo de datos
description: Cómo se guarda un documento en la base de datos, qué es la metadata compilada y qué se indexa de verdad.
---

Ferris guarda cada DocType en una tabla propia con **columnas reales**: las de
sistema, una por campo declarado y una tabla hija por campo `Table`. No hay blob
JSON por documento: el documento se **reconstruye** desde esas columnas y filas
hijas. Esa uniformidad es lo que permite tratar igual un DocType compilado con
`#[doctype]`, uno declarado por un plugin y uno ampliado con custom fields.

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

`ferris_schema::migration::document_columns()` define exactamente ocho:

| Columna | Tipo | Notas |
|---|---|---|
| `name` | `VARCHAR(255)` | Clave primaria. Es el nombre del documento. |
| `owner` | `VARCHAR(255)` | Nullable. Dueño resuelto de la sesión, nunca del body. |
| `docstatus` | `SMALLINT` | `NOT NULL DEFAULT 0`. |
| `creation` | `BIGINT` | `NOT NULL`. Timestamp Unix. |
| `modified` | `BIGINT` | `NOT NULL`. Timestamp Unix. |
| `modified_by` | `VARCHAR(255)` | Nullable. Quién hizo el último cambio. |
| `amended_from` | `VARCHAR(255)` | Nullable. Documento origen de una enmienda. |
| `workflow_state` | `VARCHAR(255)` | Nullable. Estado del workflow. |

Son las columnas que el motor sella y por las que ordena y filtra. Cada campo
declarado añade además su propia columna tipada, y cada campo `Table` una tabla
hija real.

## Columnas declaradas

`ferris_schema::doctype_columns` es la única traducción de un `FieldMeta` a una
columna física:

| Fieldtype | Tipo |
|---|---|
| `Data`, `Select`, `Link`, `Dynamic Link`, `Attach`, `Table MultiSelect` | `VARCHAR(255)` |
| `Small Text`, `Text`, `Long Text`, `Text Editor`, `Code`, `JSON` | `TEXT` |
| `Int` | `BIGINT` |
| `Float`, `Currency`, `Percent` | `DOUBLE` |
| `Check` | `BOOLEAN` |
| `Date` | `DATE` (`TEXT` en SQLite) |
| `Datetime` | `TIMESTAMP`/`DATETIME` (`TEXT` en SQLite) |
| `Password`, `Secret` y el resto de tipos conocidos | `TEXT` |

Los fieldtypes de maquetación (`Section Break`, `Column Break`, `Tab Break`,
`HTML`, `Button`, `Image`, `Fold`, `Heading`) no tienen columna: no guardan un
valor propio. Un `JSON` declarado sí es una columna JSON, porque el JSON es el
dato.

Al leer, el motor reconstruye el `Value` del documento desde las columnas y las
tablas hijas; al escribir, solo escribe columnas. Un campo que no sea columna ni
tabla hija es un **error de escritura**, no se degrada a un blob.

## Tablas hijas

Un campo `Table` crea una tabla real para el DocType hijo, con las mismas
columnas de sistema más `parent`, `parenttype`, `parentfield` e `idx`, y una
columna por campo del hijo. El DocType hijo se declara con `is_child_table` y el
tipo que genera `#[doctype]` implementa `ChildDocument`.

Un Child DocType **nunca** sigue Document Naming Rules: se direcciona por su fila
padre, y un contador global filtraría nombres entre padres distintos.

Las filas hijas se escriben en la misma transacción que el padre y se leen
agrupadas por `parent`, `parentfield` e `idx` para reconstruir el array del
documento.

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

Toda tabla recibe cuatro índices por defecto:

```rust
("idx_owner",          &["owner"],           false),
("idx_modified",       &["modified"],        false),
("idx_owner_modified", &["owner", "modified"], false),
("idx_docstatus",      &["docstatus"],       false),
```

Los nombres son lógicos: `ensure_index` los cualifica con la tabla
(`idx_<tabla>_owner`), porque PostgreSQL y SQLite comparten un espacio de nombres
de índices por esquema.

Los índices declarados en `meta.indexes` se clasifican con
`ferris_schema::migration::classify_index` en dos casos:

- `DeclaredIndex::Columns` — todos los campos nombrados son columnas reales: se
  crea un índice normal, y la lista empuja filtros y orden.
- `DeclaredIndex::Unsupported` — un campo sin columna (o una lista vacía): se
  omite. Sin blob no hay expresión JSON portable que indexar.

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

:::note[Una columna por campo]
Cada campo declarado es una columna nativa: se puede filtrar, ordenar e indexar
sin expresiones JSON. Un campo nuevo se materializa con `ensure_table`/`migrate`
(añade la columna nullable) salvo que sea de maquetación o una tabla hija. El
esquema sigue siendo uniforme entre un DocType compilado y uno ampliado con
custom fields.
:::
