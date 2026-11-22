---
title: DocTypes
description: "La unidad de modelado de Ferris: qué declara, cómo se compila o
  registra y qué genera en el motor y en el Desk."
slug: 0.2/conceptos/doctypes
---

Un **DocType** es una declaración de datos con su comportamiento. Define un
conjunto de campos, un módulo al que pertenece, cómo se nombran sus documentos y
qué roles pueden hacer qué. De esa declaración salen la tabla física, la
validación, el formulario, las columnas de la lista y el payload que consume el
navegador.

Es el equivalente al DocType de Frappe, y la comparación es intencionada: Ferris
reproduce el modelo (metadata + motor + Desk) en Rust.

## Anatomía

Un DocType tiene:

* **nombre** — identificador único. Determina la tabla: `tab<name>` sin espacios.
* **módulo** — agrupación en el Desk (`core`, `Billing`, …). No afecta al
  almacenamiento.
* **campos** — lista ordenada de `FieldMeta`.
* **permisos** — lista de `PermissionRule` (una fila `DocPerm` cada una).
* **naming** — cómo se acuña el `name`.
* **flags** — `is_submittable`, `is_single`, `is_child_table`, `is_tree`,
  `is_virtual`, `track_changes`, `allow_rename`, `allow_delete`, …
* **workflow** — nombre del workflow registrado, si lo hay.

## Declararlo con `#[doctype]`

```rust
use ferris_macro::doctype;

#[doctype(
    name = "ToDo",
    module = "core",
    naming = "TODO-.#####",
    permissions = [
        { role = "System Manager", read = true, write = true, create = true, delete = true },
        { role = "User", read = true, write = true, create = true },
    ]
)]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToDo {
    #[key]
    pub name: String,
    #[field(type = "Data", label = "Title", reqd = true)]
    pub title: String,
    #[field(type = "Select", label = "Status", options = "open\nclosed")]
    pub status: String,
    #[field(type = "Email", label = "Owner Email")]
    pub email: Option<String>,
    pub docstatus: ferris_core::DocStatus,
}
```

Reglas que aplica la macro:

* El `struct` debe tener campos con nombre.
* Hace falta un `name` o un campo marcado `#[key]`.
* `#[field(type = "…")]` valida el fieldtype **en tiempo de compilación**: un
  nombre desconocido es un error, no una cadena que nadie entiende.
* Atributos de campo admitidos: `type`, `label`, `options`, `default`, `reqd`,
  `read_only`, `hidden`, `depends_on`, `description`, `in_list_view`,
  `in_standard_filter`, `in_global_search`, `in_preview`, `bold`, `print_hide`,
  `report_hide`, `permlevel`, `unique`, `search_index`, `sort_options`,
  `allow_on_submit`, `no_copy`, `ignore_user_permissions`, `ignore_xss_filter`, y
  los de presentación (`precision`, `max_length`, `placeholder`, …).
* Si no declaras `naming`, el valor por defecto es
  `{tres primeras letras en mayúscula}-.#####`.

La expansión genera:

```text
struct limpio (sin los atributos #[field]/#[key])
fn __ferris_doctype_meta_ToDo() -> &'static DoctypeMeta   // OnceLock
impl ToDo { pub fn ferris_register_doctype() -> &'static DoctypeMeta }
impl Document for ToDo { … }        // CRUD, getters, setters, validate
impl ChildDocument for ToDo { … }   // parent/parentfield/parenttype/idx
```

El `OnceLock` se inicializa en el primer uso y llama a
`ferris_schema::registry::register_doctype`. **No** hay que llamar a nada en
`main`: registrar es perezoso, y `Document::validate` o
`ToDo::naming_series()` fuerzan el registro.

## Metadata compilada vs registrada en runtime

Las tres fuentes desembocan en `ferris_schema::registry`:

| Fuente | Cuándo | Cómo |
|---|---|---|
| `#[doctype]` | Compilación | Genera un `DoctypeMeta` literal y lo registra en el primer uso. |
| Builders | Arranque o tests | `DoctypeMeta::new("Invoice", "Billing").field(..)` y `register_doctype`. |
| `describe()` de un plugin | Carga de la app | El host recibe el descriptor por WIT y lo registra. |

`register_doctype` es idempotente: registrar dos veces el mismo nombre no apila
nada. Un DocType **sin** entrada en el registro sigue pudiendo usarse por la API
dinámica (el motor acepta `ctx.meta = None`), pero pierde validación declarativa,
permisos de campo, virtuales y naming declarado.

Sobre esa base, las personalizaciones en runtime se aplican **encima**:
`Custom Field` añade campos y `Property Setter` cambia propiedades. El resultado
es la metadata *efectiva*, que es la que ve cada petición y la que se envía al
Desk.

## Naming

El `name` es la clave primaria y también vive dentro del blob `data`. Se acuña
según `naming_type`, que se resuelve una sola vez:

```rust
NamingType::resolve(explicit, &naming_series)
// explícito si lo hay; si no: series si `naming_series` no está vacío, UUID si lo está
```

Antes de eso, una **Document Naming Rule** que case tiene prioridad sobre la
declaración del DocType. Y `BeforeNaming` puede fijar el `name` directamente, en
cuyo caso el motor solo acuña si el hook lo dejó vacío.

Detalle completo en [Naming](/0.2/conceptos/naming/).

## Permisos

`permissions = [ … ]` se convierte en `Vec<PermissionRule>`, y de ahí en
`PolicyStatement`s del motor. Cada regla es rol × derechos × DocType, con
`permlevel == 0` obligatorio para contar como permiso de documento y `if_owner`
como restricción adicional.

Un rol que no aparece no tiene ningún derecho: **deny por defecto**. Detalle en
[Permisos](/0.2/conceptos/permisos/).

## Flags que cambian el comportamiento

| Flag | Efecto |
|---|---|
| `is_submittable` | Habilita `docstatus` 0→1→2 y los permisos `Submit`/`Cancel`/`Amend`. |
| `is_single` | Un solo documento, nombrado como el DocType, sin lista. |
| `is_child_table` | Solo se embebe en un padre; sin naming rules. El tipo generado expone los accesores de `ChildDocument`. |
| `is_tree` | Documento con jerarquía (nested set). |
| `is_virtual` | Sin tabla; las filas las sirve un `VirtualDoctypeProvider`. |
| `track_changes` | Registra cada escritura en `tab_version`. |
| `allow_rename` | Sin este flag, `rename` devuelve `RenameNotAllowed`. |
| `allow_delete` | Señal de UI; el borrado real lo decide el permiso `Delete`. |
| `read_only` | El Desk no ofrece crear ni editar; el motor sigue sirviendo el documento. |
| `hidden` | Fuera de listas de workspace y búsqueda global. |

## Relación con la tabla

```text
DocType "ToDo"  ──▶  tabToDo (name, owner, docstatus, creation, modified, data)
                     └─ data = {"name": "...", "title": "...", "status": "...", ...}
```

La tabla se crea de dos formas y ambas comparten definición: `ferris migrate`
genera la migración, y el motor hace `ensure_table` en la primera escritura. Los
campos no tienen columna; viven en `data`. El
[modelo de datos](/0.2/arquitectura/modelo-de-datos/) explica el porqué y sus
consecuencias para índices y consultas.

## Cómo comprobar que existe

Antes de usar un DocType en código, se puede verificar en el registro:

```rust
if let Some(meta) = ferris_schema::get_doctype("ToDo") {
    println!("{} campos, {} reglas", meta.fields.len(), meta.permissions.len());
}
```

Y por HTTP, el payload que consume el Desk:

```bash
curl -s localhost:8000/api/doctype/meta/ToDo | jq '.fields[].fieldname'
```
