---
title: Paridad con Frappe
description: Matriz de las 17 características de DocType y de las superficies de API, con la pieza WIT, interna y de Desk que las implementa.
---

Esta página es el contrato de paridad: cada fila nombra la característica de
Frappe, la superficie WIT que la expone a una app, la API interna que la aplica
y la parte del Desk que la usa. Una fila sin las tres columnas es una brecha, no
una promesa.

## DocTypes

| Característica | WIT | API interna | Desk |
|---|---|---|---|
| `docstatus` | `data.set-docstatus` (`submit`/`cancel`/`amend`), `data.doctype-json` | `DocumentEngine::set_docstatus`, `DocStore::set_docstatus` | insignia de estado y acciones Enviar/Cancelar/Amendar |
| Módulos | `descriptor.doctype` (module) | `DoctypeMeta.module`, `Module Def` | selector de módulo y workspace |
| Virtual DocField | `data.doctype-json` (`field.virtual`) | `FieldMeta.virtual`, `redact_read` + proveedor | campo de solo lectura, nunca en el payload |
| Fieldtypes | `data.field-types` | `ferris_schema::fieldtype::FIELDTYPES` | `render_form_field` |
| Naming | `data.next-name`, `data.doctype-json` | `NamingType` (10 métodos), `Document Naming Rule` | campo de id editable solo en `Prompt`/`Field` |
| DocField | `data.doctype-json` | `FieldMeta` completo y `DynField` espejo | render, validación, layout y permisos de campo |
| Controllers | `doctype-event` | `HookPoint` (23 puntos), `DocumentEngine::rename` | acciones y refresco tras eventos |
| Form & view settings | `data.doctype-json` | `DynMeta.view`, `default_view`, `kanban/calendar/tree/gantt_*` | selector de vistas y ajustes de formulario |
| Child DocType | `data.doctype-json` (`is-child-table`) | `parent`/`parenttype`/`parentfield`/`idx`, tablas hijas | editor de tabla hija |
| Single DocType | `data.doctype-json` (`is-single`), `get-docs` con el nombre fijo | `is_single`, `get_single`/`save_single` | formulario de una sola fila |
| Virtual DocType | `data.doctype-json` (`is-virtual`) | `register_virtual_doctype` | list/form genéricos sobre el proveedor |
| Actions y Links | `data.doctype-json` (`actions`, `links`) | `ferris_schema::registry::doc_actions/doc_links`, `GET /api/doctype/connections/...` | botones y panel Connections |
| Customize | `data.doctype-json` | `CustomizationStore`, `Custom DocPerm` | editor «Personalizar» |
| Data masking | `data.doctype-json` (`field.mask`) | `redact_read`, `Password`/`Secret`, `FieldMeta.mask` + permiso `mask` | campo enmascarado cuando falta el permiso |
| Permission Types | `platform.can` (nombre no integrado → `Custom DocPerm`) | `has_custom_permission`, `GET /api/doctype/permissions/{doctype}` | matriz permiso × rol |
| DocType Layout | `descriptor.doctype` y `data.doctype-json` | `Tab Break`/`Section Break`/`Column Break` | tabs, secciones y columnas |
| Allow on Submit | `data.doctype-json` (`allow-on-submit`) | `allow_on_submit` en `update.rs` | campo editable solo con `docstatus = 1` |

## API de Desk

| Superficie | WIT / API | Implementación |
|---|---|---|
| `frappe.call`, `frappe.db.*` | `data.*`, `platform.can`, `POST /api/method` | `DocStore`, `api::client` |
| Formulario | `descriptor` + `data.doctype-json` | `FormService` |
| Controles | `data.field-types` | `render_form_field` |
| Lista | `data.list-docs`, `count-docs`, `aggregate-docs` | `ListService`/`ListView` |
| Página | `descriptor.website`, dashboards | `PageHeader` + páginas de app |
| Árbol | `data.list-docs` + `tree_*` | `TreeView` |
| Utilidades | `ferris-web-shared` | fechas, formato y rutas |
| Diálogos | componentes Leptos | `Dialog`, `AlertDialog`, `Sheet`, `toast` |
| Gráficos | componentes Leptos | `components/ui/charts` |
| Scanner | componente Leptos | `components/ui/scanner` |
| Llamadas al servidor | REST + `DocStore` | `api::client` / `api::server` |
| Logging | `POST /api/log/client` | `api::log_client` |
| Form Tours | `GET /api/doctype/form-tours/{doctype}` | `Form Tour`, `Tour`, `FormTourLauncher` |

## Qué expone el WIT y qué no

El contrato de plugin es deliberadamente estable. Un DocType declarado por una
app usa `descriptor.doctype` (el subconjunto que el host valida al cargar) o, si
necesita la metadata completa, `schema.declare-doctype(json)` dentro de
`describe()` (JSON de `DoctypeMeta`); `data.doctype-json` es la proyección de
lectura (`DynMeta`). Las operaciones
que cambian el ciclo de vida (`set-docstatus`, `rename-doc`) y la introspección
(`doctype-json`, `field-types`) son funciones nuevas, no campos nuevos de un
record: un guest antiguo sigue compilando.

`platform::can` acepta tanto un derecho integrado (`read`, `write`, `submit`, …)
como un **Permission Type** (`approve`, `download`, …). Un nombre que no es un
derecho integrado se resuelve contra `Custom DocPerm`, con la misma regla
`if_owner`/rol que el Desk.

## Límites explícitos

- **Form scripts / Client Script**: no hay un intérprete de JavaScript
  almacenado en la base de datos. El equivalente es un plugin WASM
  (`doctype-event` + `handle-request`) y sus assets de UI.
- **`frappe.ui.Page` como constructor de layouts**: el Desk no evalúa un layout
  guardado; una página propia se declara como `website`/dashboard y se sirve por
  ruta.
- **`RealtimeChart`**: el gráfico existe; la actualización en vivo usa el feed de
  eventos/realtime y una señal de datos, no un socket propio del componente.
- **`data.doctype-json`** devuelve la metadata **efectiva**: el registro, las
  customizaciones del sitio (`Custom Field`/`Property Setter`), `Custom DocPerm`
  y las filas de Actions/Links/Permission Types. Es la misma proyección que
  `GET /api/doctype/meta/{doctype}`; la implementación vive en
  `ferris_schema::effective_meta` y la comparten REST, SSR y el host WASM.
