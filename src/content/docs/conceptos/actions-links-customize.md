---
title: Actions, Links y Customize
description: Botones de formulario, panel de Connections, campos y propiedades en caliente, y qué se ejecuta realmente.
---

Un DocType no es solo campos. Ferris modela también las **acciones** de un
formulario, los **enlaces** del panel de Connections y las **personalizaciones**
del sitio, todo como datos que viajan en el payload de metadata.

## `DocType Action`

Una fila declara un botón de formulario o de lista. El servidor las lee de
`tabDocTypeAction` y las publica en `DynMeta.actions`:

| Campo | Uso |
|---|---|
| `name` | Nombre de la fila; permite al editor borrar exactamente esa acción. |
| `label` | Texto del botón. |
| `action_type` | `Server Action` o `Route` (el `action_type` de Frappe). |
| `action` | El método `/api/method/…` o la ruta que invoca. |
| `group` | Agrupación opcional en el Desk. |
| `hidden` | Declarada pero no ofrecida. |

Orden de presentación: por `group` y luego por `label`, así que el Desk no depende
del orden de inserción.

## `DocType Link`

Una fila declara una relación para el panel **Connections**. Se lee de
`tabDocTypeLink` y se publica en `DynMeta.links`:

| Campo | Uso |
|---|---|
| `link_doctype` | DocType del otro lado. |
| `link_fieldname` | Campo de **este** DocType que apunta al documento actual. |
| `table_fieldname` | Child table que contiene el campo, cuando el enlace no está en el padre. |
| `group` | Agrupación en el panel. |
| `hidden` | Declarado pero no ofrecido. |

### Cómo se resuelven los connections

`GET /api/doctype/connections/{doctype}/{name}` devuelve
`{ "connections": [ { link_doctype, link_fieldname, group, count, documents } ] }`.

- **Enlace externo** (sin `table_fieldname`): una lista del DocType enlazado con
  `filters = { link_fieldname: name }`. Pasa por `DocStore::list`, es decir, por el
  filtro de `Read` del motor.
- **Enlace interno** (`table_fieldname`): no hay columna que filtrar, así que se
  pagina el DocType enlazado (tope duro de **100** filas) y se escanea el array en
  Rust. Es explícito a propósito: el blob JSON no está indexado.
- Se omiten los enlaces `hidden` o incompletos, y los grupos sin documentos no se
  emiten.

:::caution[El tope de 100]
Una conexión interna solo ve las primeras 100 filas del DocType enlazado. Si tu
caso necesita más, el dato debe modelarse como un `Link` real en el padre, no
dentro de una child table.
:::

## `Permission Type`

Declara un derecho con nombre propio para el DocType (`approve`, `verify`, …). Se
lee de `tabPermissionType` y se publica en `DynMeta.custom_permissions` con `role`
vacío: es la **declaración**. La asignación a roles vive en
`Custom DocPerm.custom_permissions`, y la resuelve
`has_custom_permission`/`has_custom_permission_on`.

Detalle en [Permisos](/conceptos/permisos/#permission-type-y-custom_permissions).

## El payload de metadata

`effective_dyn_meta(pool, doctype)` es la única función que construye
`GET /api/doctype/meta/{doctype}`:

```text
registro  →  CustomizationStore::apply  →  Custom DocPerm  →  DynMeta::from_serde_meta
          →  + actions  + links  + custom_permissions
```

El handler REST y el puente SSR llaman a la misma función, así que el Desk
hidratado y el renderizado en servidor reciben exactamente el mismo payload. Los
tres conjuntos de filas son **opcionales**: una base que nunca creó sus DocTypes de
metadata devuelve listas vacías, no un error. Una fila corrupta sí falla: es
metadata rota, no ausencia.

## Customize Form

La superficie de personalización es `/api/customization/{doctype}`:

| Método y ruta | Efecto |
|---|---|
| `GET /api/customization/{doctype}` | Campos y propiedades actuales. |
| `POST …/fields` | Añade o reemplaza un custom field. |
| `DELETE …/fields/{fieldname}` | Borra el custom field. |
| `POST …/properties` | Añade o reemplaza un property setter. |
| `DELETE …/properties/{property}` | Borra el setter. |
| `POST …/export` | Exporta una selección al formato de mundo de un plugin. |

### Custom Fields

Un campo añadido en runtime se guarda en `tab_custom_field` y se aplica **solo si
el DocType no tiene ya un campo con ese `fieldname`**: un custom field **no puede
sobrescribir** un campo compilado; para cambiar su comportamiento se usa un
property setter. `fieldtype` pasa por el allowlist canónico
(`fieldtype::canonical`), así que solo se acepta la grafía exacta y un nombre
desconocido es `SchemaError::InvalidFieldType`; un `label` vacío se rellena
con el `fieldname`; `insert_after` coloca el campo tras el ancla (o al final si no
existe); y los layout breaks (`Tab Break`, `Section Break`, `Column Break`) son
custom fields normales. Un campo custom es un `FieldMeta` más: valida, aparece en el
formulario y cuenta para permisos de campo.

### Property Setters

Un setter sobrescribe **una** propiedad de un DocType o de uno de sus campos.
`fieldname = None` significa "propiedad del DocType".

Propiedades de campo que `apply` reconoce:

```text
label, fieldtype, options, default, description, placeholder, depends_on,
reqd, hidden, read_only, in_list_view, in_standard_filter, unique
```

Propiedades de DocType:

```text
title_field, search_fields, naming_series, sort_field, sort_order, description
```

Y una propiedad reservada muy útil: **`insert_after`**. Se aplica al final, cuando
los valores ya están puestos, y mueve el campo (también uno compilado) a la
posición indicada. El ancla `__first__` lo pone al principio. Un ancla inexistente
deja el campo donde estaba, en lugar de mandarlo al final.

:::caution[Propiedades fuera de la lista]
Un setter con una propiedad que `apply` no conoce se **almacena** pero no tiene
efecto. No hay error. Si una personalización "no hace nada", comprueba el nombre
de la propiedad contra las dos listas de arriba.
:::

Un `fieldtype` puesto por setter pasa por el mismo allowlist que un custom field y
se guarda canonicalizado.

### `custom = 1`

Un DocType declarado por la app puede marcarse `custom` (`custom: true` en
`DoctypeMeta`, `custom = true` en la macro). Es una señal de que el DocType nace
para personalizarse en el sitio, no una regla de permisos.

### Export a un mundo de plugin

`POST /api/customization/{doctype}/export` escribe los cambios seleccionados como
`plugins/<app>/customizations/<doctype>.json`, con esta forma:

```json
{ "doctype": "Task",
  "fields": [ { "fieldname": "priority", "fieldtype": "Select", "options": "Low\nHigh" } ],
  "properties": [ { "fieldname": null, "property": "title_field", "value": "subject" } ] }
```

El nombre del DocType viaja **dentro** del fichero porque el nombre del fichero es
un stem saneado (`Task-Line` para `Task Line`) y no se puede revertir. `ferris
migrate` aplica esos ficheros de vuelta a `tab_custom_field` y
`tab_property_setter`, que es lo que hace efectivo un mundo exportado en una base
nueva. El endpoint acepta un `ExportScope` para exportar solo lo que el usuario
cambió en esta sesión (`{"Fields": [...]}` o
`{"Properties": [[fieldname, property], ...]}`), de modo que el fichero sea un diff
revisable y no una foto de todas las personalizaciones previas.

## Client Script y Server Script

Ferris declara los DocTypes `Client Script` y `Server Script` (módulo Build,
visibles en el workspace, con `script_type` y `event_type`), y los guarda como
cualquier documento. **No los ejecuta**: no hay intérprete de JavaScript ni de
Python embebido, ni un cargador que los enchufe al ciclo de vida. Sus campos
`script` se almacenan como texto y ningún componente del árbol los consume.

El motivo es concreto: una plataforma que evalúa cadenas de código de la base de
datos necesita un sandbox, un límite de tiempo y un modelo de capacidades; sin eso
es una vulnerabilidad, no una feature. El equivalente real son los **plugins
WASM**, que sí tienen sandbox, capacidades declaradas, límites y un contrato
versionado.

Para lógica de negocio, el camino es:

| Necesitas | Usa |
|---|---|
| Lógica in-process del framework | Un hook `HookFn` ([controladores](/conceptos/controladores/)). |
| Comportamiento de una app externa | Un plugin WASM con `doctype-event`. |
| Un botón que llame a algo | `DocType Action` con `action_type = Server Action`. |
| Un enlace en el panel Connections | `DocType Link`. |

:::note[No prometas lo que no hay]
Si vienes de Frappe y buscas el editor de Server Script, aquí encontrarás el
DocType y su almacenamiento, pero no ejecución. Escribir un script ahí no cambia
ningún comportamiento.
:::
