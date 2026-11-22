---
title: Tu primer DocType
description: Declara un DocType, regístralo, migra, haz CRUD por la API y ábrelo en el Desk con permisos mínimos.
---

Un **DocType** es la unidad de modelado de Ferris: un nombre, un módulo, una
lista de campos, permisos y un puñado de flags (`is_submittable`, `is_single`,
`is_child_table`, …). El motor de documentos y el Desk trabajan sobre esa
declaración; no hay formularios ni SQL escritos a mano.

Hay dos caminos para declararlo:

1. **Metadatos en Rust** con `DoctypeMeta`/`FieldMeta` (o el macro
   `#[doctype]`), para código de una crate nativa.
2. **`describe()` de una app WASM**, para el proyecto que crea `ferris new`.

## Camino 1: metadatos en Rust

```rust
use ferris_schema::builders::RolePermission;
use ferris_schema::{DoctypeMeta, FieldMeta};

pub fn task_meta() -> DoctypeMeta {
    DoctypeMeta::new("Task", "Projects")
        .description("Una tarea asignable a una persona.")
        .title_field("subject")
        .naming_series("TASK-.#####")
        .allow_delete()
        .field(
            FieldMeta::data("subject")
                .label("Asunto")
                .required()
                .in_list_view(),
        )
        .field(FieldMeta::select("status", "Open\nWorking\nDone"))
        .field(FieldMeta::date("due_date").label("Vence"))
        .field(FieldMeta::link("project", "Project").label("Proyecto"))
        .permission(
            RolePermission::new("Projects User")
                .read()
                .write()
                .create(),
        )
        .permission(
            RolePermission::new("System Manager")
                .read()
                .write()
                .create()
                .delete(),
        )
}
```

Registrarlo es idempotente y seguro en cada arranque o recarga:

```rust
pub fn register() {
    ferris_schema::registry::register_doctype(task_meta());
}
```

Sobrescribe la misma clave si ya existe. La tabla física no se crea aquí: el
motor la materializa la primera vez que se toca el DocType.

:::note[Macro `#[doctype]`]
Puedes anotar un struct con `#[doctype(name = "Task", module = "Projects", …)]`
y `#[field(...)]` por campo. El macro emite la misma `DoctypeMeta` y valida el
fieldtype al compilar: `type = "Dat"` no compila.
:::

## Camino 2: `describe()` de una app

El scaffold de `ferris new` declara tres campos con nombre y deja que el host
infiera el fieldtype:

```rust
doctypes: vec![descriptor::Doctype {
    name: "Task".to_string(),
    is_submittable: false, is_single: false,
    allow_submit: false, allow_cancel: false, allow_amend: false,
    allow_delete: false, allow_copy: false, allow_print: false,
    allow_rename: false,
    in_calendar: false, in_kanban: false, in_gantt: false,
    in_tree_view: false, in_report_view: false,
    view: descriptor::DocView::Form,
    fields: vec![
        descriptor::Field::Name("subject".to_string()),
        descriptor::Field::Name("status".to_string()),
        descriptor::Field::Name("due_date".to_string()),
    ],
    indexes: Vec::new(),
    list_default_order: None,
}],
```

Para controlar tipo, obligatoriedad, opciones o columna de lista, usa
`descriptor::Field::Config(descriptor::FieldConfig { … })` con `fieldtype`
(`"Data"`, `"Select"`, `"Date"`, …), `reqd`, `options`, `in_list_view` y el
resto de knobs del record `field-config` del WIT.

`Field::Name` infiere por nombre: `subject` → `Data`, `status`/`Status` →
`Select`, `due_date` → `Date`. Un plugin recibe la serie `<DOCTYPE>.#####`
(`TASK.#####`) salvo que sea `is_single`.

## Migrar

```bash
ferris migrate
```

Aplica migraciones de esquema y personalizaciones exportadas de cada app. Un
DocType nuevo no necesita una migración escrita a mano —su tabla se crea de forma
perezosa en el primer acceso— pero migrar deja listo el resto del esquema.

## CRUD por la API

Abre sesión y guarda cookie y token CSRF:

```bash
curl -s -c cookies.txt -D headers.txt -X POST \
  http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@local","password":"ferrisAdmin123"}'

CSRF=$(awk 'tolower($1)=="x-csrf-token:"{print $2}' headers.txt | tr -d '\r')
```

Crear:

```bash
curl -s -b cookies.txt -X POST http://localhost:8000/api/resource/Task \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"subject":"Revisar el README","status":"Open","due_date":"2026-12-01"}'
```

Leer y listar:

```bash
curl -s -b cookies.txt http://localhost:8000/api/resource/Task/TASK.00001

curl -s -b cookies.txt -X POST \
  http://localhost:8000/api/resource/Task/list \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"limit_page_length":20,"order_by":"modified desc"}'
```

Actualizar y borrar:

```bash
curl -s -b cookies.txt -X PUT \
  http://localhost:8000/api/resource/Task/TASK.00001 \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"status":"Done"}'

curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X DELETE \
  http://localhost:8000/api/resource/Task/TASK.00001 \
  -H "X-CSRF-Token: $CSRF"
```

Un `POST` responde `201` con el documento creado; el `DELETE` responde `204`.
Los detalles de filtros y paginación están en [recursos](/api/recursos/).

## Verlo en el Desk

La lista vive en `/desk/{module}/{doctype}` y el documento un segmento más
abajo:

- `http://localhost:8000/desk/Projects/Task`
- `http://localhost:8000/desk/Projects/Task/TASK.00001`

Si el módulo no aparece en el grid, revisa que el DocType esté registrado y que
tengas `Read`; el Desk solo ofrece lo que el metadato y los permisos permiten.

## Permisos mínimos

Sin ninguna regla declarada, la política base solo concede a `System Manager`
(`Policy::default_document_permissions`): **un DocType sin permisos no es
público**, es invisible para el resto de roles.

- En metadatos Rust, añade `.permission(RolePermission::new(...))` por rol.
- En una app WASM el record `doctype` no lleva permisos: se administran con el
  constructor (`PUT /api/doctype/permissions/{doctype}/manage` o
  `/api/authz/role-permissions`), que escribe filas `DocPerm` y reinstala la
  política sin reiniciar.
- `if_owner()` restringe a los documentos cuyo `owner` es el llamador.
- `permlevel(n)` protege campos concretos; nivel 0 es el documento.

:::caution[Comprueba con un usuario real]
Un `admin@local` con `System Manager` puede hacer todo y no demuestra nada. Prueba
con una cuenta del rol que declaraste; un `403` significa que falta la regla.
:::

Siguiente: [permisos](/conceptos/permisos/) y
[errores y permisos de la API](/api/errores-y-permisos/).
