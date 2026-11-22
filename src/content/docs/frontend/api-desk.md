---
title: API del Desk
description: Qué API nativa corresponde a cada superficie del Desk de Frappe (formularios, controles, listas, páginas, árboles, diálogos, gráficos, escáner, llamadas al servidor, logging y tours).
---

El Desk no evalúa JavaScript almacenado en la base de datos: la lógica de una
app vive en un componente WASM (`describe`/`doctype-event`/`handle-request`) y la
UI es un custom element que el host monta en un slot. Por eso la API de Frappe
no se reproduce como un objeto global `frappe` que lee y escribe un DOM ajeno,
sino como **superficies nativas** con el mismo alcance. Esta página es el mapa
entre ambas: qué hace cada API de Frappe y dónde está la pieza equivalente en
Ferris.

## Resumen

| API de Frappe | Equivalente en Ferris | Dónde |
|---|---|---|
| `frappe.call`, `frappe.db.*` | `DocStore` / `ferris-web::api::client` / `POST /api/method` | [`DocStore`](/frontend/ssr-hidratacion/) |
| `frappe.ui.form` | `FormService` + `render_form_field` | [`Formularios`](/frontend/formularios/) |
| `frappe.ui.form.make_control` | `render_form_field` y los 47 fieldtypes | [`Fieldtypes`](/referencia/fieldtypes/) |
| `frappe.ui.ListView` | `ListView` + `ListService` | [`Listas y tablas`](/frontend/listas/) |
| `frappe.ui.Page` | `Page` DocType, páginas de app y el chrome compartido | [`El Desk`](/frontend/desk/) |
| `frappe.ui.Tree` | `TreeView` | [`Listas y tablas`](/frontend/listas/) |
| `frappe.utils` | `ferris-web-shared` (fechas, formato, rutas) | [`SSR e hidratación`](/frontend/ssr-hidratacion/) |
| `frappe.ui.Dialog` y familia | `Dialog`, `AlertDialog`, `Sheet`, `Drawer`, `toast` | [`Biblioteca de componentes`](/frontend/componentes-ui/) |
| `frappe.Chart`, `RealtimeChart` | `components/ui/charts` | [`Dashboards y widgets`](/frontend/dashboards-y-widgets/) |
| `frappe.ui.Scanner` | `components/ui/scanner` (`Scanner`) | [`API del Desk`](/frontend/api-desk/#scanner) |
| `frappe.call`/`xcall` | `DocStore` y `api::client::*` | esta página |
| `frappe.logger`/`frappe.log` | `api::log_client` → `POST /api/log/client` | esta página |
| Form Tours | `Form Tour`/`Form Tour Step` + `Tour`/`FormTourLauncher` | esta página |

## Llamadas al servidor

La regla de la casa es una sola: una vista nunca llama a `fetch` ni a `reqwest`
directamente. Habla con `DocStore`, que en SSR ejecuta el motor en proceso y en
el navegador usa el cliente HTTP. Así el HTML del servidor y la hidratación
enseñan los mismos datos.

```rust
use crate::api::DocStore;

let store = DocStore::runtime()?;
let meta = store.meta("Task").await?;
let page = store.list("Task", &params).await?;
let tour = store.form_tours("Task").await?;
```

Para un método de app, `POST /api/method/<name>` sigue siendo la superficie
pública; el cliente la envuelve en `api_call_method`. El servidor resuelve la
cadena de overrides (`base → apps`) y autoriza como el usuario de la sesión.

## Formulario

`FormService` es el equivalente de `frappe.ui.form.on`: carga la metadata y el
documento, construye `FormField`s, decide qué campos son editables según
`docstatus`/`allow_on_submit` y expone las acciones del ciclo de vida. Los
eventos de Frappe (`setup`, `onload`, `refresh`, `validate`, `before_save`, …) se
corresponden con los `HookPoint` del motor y con `doctype-event` para una app
WASM; no hay un intérprete de scripts de cliente.

## Controles

`render_form_field` es el `make_control` de Ferris: recibe un `FormField` y
devuelve el control que corresponde a su `fieldtype`. Un campo con `mask` llega
ya enmascarado del motor salvo que el usuario tenga el permiso `mask` en su
`permlevel`. La lista canónica vive en
`ferris_schema::fieldtype::FIELDTYPES` y la misma lista se publica al guest por
`data.field-types`. Un `fieldtype` fuera de ella se rechaza en las rutas
estrictas (descriptor, customización, DocType almacenado).

## Lista y árbol

`ListService`/`ListView` cubren filtros, orden, paginación, selección, acciones
masivas y los modos `list`, `kanban`, `calendar`, `gantt`, `tree`, `report`.
`TreeView` exige `is_tree` y un `tree_parent_field` que sea un `Link` al mismo
DocType; sin esa configuración la vista lo dice, no dibuja un árbol vacío.

## Página

Una página de Frappe (`frappe.ui.make_app_page`) se compone de título,
indicador, acciones y un formulario de filtros. En Ferris esa carcasa es
`PageHeader`/`SectionTitle` y el chrome del Desk; una página propia de una app se
declara como `website` (`page` o `bare`) o como dashboard, y el host la sirve en
su ruta. El DocType `Page` guarda la identidad de una página del Desk; no es un
intérprete de layout.

## Diálogos

`Dialog` es el `frappe.ui.Dialog` controlado: `open` es una señal y el cierre
(ESC, backdrop, botón) escribe en ella. `AlertDialog` cubre `frappe.confirm` y
`frappe.warn`; `Sheet`/`Drawer` cubren los paneles laterales; `toast` cubre
`frappe.show_alert`. `msgprint`, `prompt` y `show_progress` se construyen con
esos primitivos, no con un segundo sistema de overlays.

## Gráficos

`components/ui/charts` dibuja los tipos de `frappe.Chart` (línea, área, barras,
donut) sobre SVG y tokens del tema. Un widget `kind = "chart"` los usa en un
dashboard; un panel de una app puede montar el mismo componente. No hay un
`RealtimeChart` con socket propio: la actualización en vivo llega por el feed de
eventos/realtime y se escribe en la señal de datos del gráfico.

## Scanner

`Scanner` abre la cámara en un diálogo, decodifica con `BarcodeDetector` y llama
a `on_scan` por cada valor. `multiple = true` mantiene el diálogo abierto y
aplica un debounce; al cerrar se paran todas las pistas de la cámara. Si el
navegador no expone `BarcodeDetector`, el componente muestra un error tipado en
lugar de fingir que no encontró nada.

```rust
use crate::components::ui::scanner::Scanner;

view! {
    <Scanner
        on_scan=Callback::new(move |code: String| { /* … */ })
        multiple=false
    />
}
```

## Logging

`api::log_client` envía `POST /api/log/client` con `level` (`warn` o `error`),
`message` y un `context` opcional. El endpoint no escribe en la base de datos:
emite una línea de `tracing` bajo el target `ferris_client`, atribuida al usuario
de la sesión, con el mensaje acotado y en una sola línea. `FormService` lo usa en
los fallos de carga y guardado para que un error no desaparezca al cerrar la
pestaña.

## Form Tours

Un tour es metadata, no código:

- `Form Tour` (`title`, `reference_doctype`, `is_standard`, `save_on_completion`,
  `show_first_document_tour`, `include_name_field`);
- `Form Tour Step` (`fieldname`, `title`, `description`, `position`,
  `next_condition`, `is_table_field`, `parent_field`).

`GET /api/doctype/form-tours/{doctype}` devuelve los tours declarados. El
formulario muestra un botón **Tour** cuando hay alguno; `Tour` resalta el campo
con un anillo, hace scroll hasta él y navega con Anterior/Siguiente/Listo. Un
selector que no case no bloquea el tour: la copy se sigue mostrando.
`include_name_field` antepone el paso del id y `save_on_completion` guarda el
documento al terminar. `show_first_document_tour` se conserva como declaración,
pero el lanzador actual no navega a otro documento: el tour se ejecuta sobre el
formulario abierto.
