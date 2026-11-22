---
title: El Desk
description: Rutas, chrome (sidebar y top bar), búsqueda global, notificaciones,
  workspaces y cómo carga los datos.
slug: 0.2/frontend/desk
---

El Desk es la aplicación que el usuario ve: un shell persistente (sidebar y barra
superior) con una tabla de rutas en el centro. `DeskShell` envuelve todo en el
documento HTML; `DeskApp` monta el chrome y `<Routes>`. El Desk **no decide
permisos**: solo refleja lo que la API y el motor permiten o niegan.

## Tabla de rutas

Declarada en `ferris-web/src/app/routes.rs` **en orden de coincidencia**: cada
ruta concreta gana y el catch-all final resuelve lo que una app declaró.

| Ruta | Vista | Notas |
|---|---|---|
| `/login` | `LoginPage` | sin chrome; el servidor redirige aquí con `?next=` |
| `/` | `HomeView` | dashboard por defecto del feed, o índice de dashboards |
| `/desk` | `Desktop` | la rejilla de iconos; es la página, no lleva sidebar |
| `/desk/:module/:doctype` | `ListView` | índice del DocType |
| `/desk/:module/:doctype/:name` | `DocRoute` | despacha `list`/`kanban`/`calendar`/`layout` o un documento |
| `/report/:name` | `ReportView` | |
| `/kanban/:doctype`, `/calendar/:doctype` | `KanbanView`, `CalendarView` | |
| `/settings`, `/settings/*rest` | `SettingsView` | cada sección es una URL real |
| `/*rest` | `PluginPage` | dashboards y páginas web declaradas por apps |

`DocRoute` existe porque las cuatro palabras clave y un nombre de documento son
la misma forma de URL. El precio: un documento llamado exactamente `list`,
`kanban`, `calendar` o `layout` queda tapado por la vista.

```rust
// ferris-web/src/views/doc_route.rs
move || match segment.get().as_str() {
    "list" => view! { <ListView /> }.into_any(),
    "kanban" => view! { <KanbanView /> }.into_any(),
    "calendar" => view! { <CalendarView /> }.into_any(),
    LAYOUT_SEGMENT => view! { <div class="contents" data-name="DocLayoutRoute"><FormView /></div> }.into_any(),
    _ => view! { <FormView /> }.into_any(),
}
```

:::tip
`/desk/:module/:doctype/layout` no es un documento: abre el **editor de forma**
del DocType (`FormService::layout_mode`), con campos y property setters en lugar
de un registro.
:::

## Chrome: sidebar, top bar y variantes

* `Sidebar` dibuja los workspaces del feed, el badge de no leídos, el buscador y
  el menú de módulo (`HeaderDropdown`, con el `ThemeDialog`).
* `TopBar` es la barra compartida: breadcrumbs, título, estado, acciones
  contextuales y los slots `shell.topbar.right`. Las vistas publican en ella con
  `use_top_bar_actions()`, `use_top_bar_status()` y `use_top_bar_title()`.
* `DeskTopBar` es la barra propia de `/desk`, con búsqueda, notificaciones, tema y
  menú de usuario, porque esa ruta no dibuja el chrome normal.
* `MobileNav` y `MobileSidebarDrawer` cubren el móvil; las preferencias por
  dispositivo (`MobilePrefs`) deciden si se muestran.

Qué rutas se pintan sin chrome lo decide un `Memo`, no un efecto que escribe un
flag:

```rust
let bare_chrome = Memo::new(move |_| {
    page_wants_bare_chrome(&ui_ctx.apps.get(), &location.pathname.get())
});
provide_bare_chrome(bare_chrome);
```

Al ser una función pura de la ruta y del feed, SSR y la hidratación no pueden
discrepar. `/login` y `/desk` son bare por ruta; una página web declarada por una
app lo es con `kind: "bare"`.

## Búsqueda global y notificaciones

`Ctrl+K` (o `Cmd+K`) abre `GlobalSearch`, una paleta única con un solo cursor de
teclado: favoritos y recientes con la consulta vacía, resultados de
`/api/search` en cuanto se escribe. Enter abre, Escape cierra; favoritos y
recientes persisten en `localStorage` (`ferris.search.recents`,
`ferris.search.favorites`) y solo en el cliente —el SSR pinta la paleta vacía.

Las notificaciones llegan por SSE desde `/api/notifications/stream`. El número de
no leídos es **una** señal (`unread_count(notifications, notif_settings)`) que
consumen el badge de la sidebar, el punto de la top bar y el título de la
pestaña, así que la preferencia "notificaciones de escritorio" los apaga a la vez.

## Workspaces y la rejilla de `/desk`

El servidor responde a `GET /api/desk-layout` con los módulos del usuario y su
rejilla de iconos. Lo que las apps declaran solo *siembra* la rejilla; después el
usuario manda: orden, carpetas y qué está oculto se guarda con `PUT
/api/desk-layout` y se relee en cada carga.

```rust
// ferris-web/src/app/mod.rs
let select_workspace = Callback::new(move |name: String| {
    picked_workspace.set(Some(name.clone()));
    let route = workspaces.with_untracked(|list| {
        list.iter().find(|ws| ws.name == name).and_then(Workspace::first_route)
    });
    if let Some(route) = route {
        navigate(&route, leptos_router::NavigateOptions::default());
    }
});
```

`Sidebar` elige el workspace activo por la ruta: si exactamente un workspace
contiene la ruta actual, esa ruta decide; si hay ambigüedad o ninguno coincide
(`/`, `/desk`, `/settings`), manda el último elegido a mano.

## Permisos

El Desk no decide permisos: los aplica el motor y la API. Lo que hace la interfaz
es **no ofrecer** lo que fallará, leyendo la metadata y los permisos que publica
el servidor (`can_create`, y en el formulario `allow_cancel`, `allow_amend`,
`allow_delete`, `allow_copy`, `allow_rename`). Un botón ausente no es una
garantía; un botón presente tampoco otorga nada.

:::caution
Nunca conviertas una comprobación de UI en la única comprobación. Si una acción
debe estar restringida, la restricción vive en el backend y la UI solo la refleja.
:::

## Carga de datos al arrancar

En el cliente, `DeskApp` hace el bootstrap una vez:

1. `desk_session::me()` revalida la sesión y, si se perdió, navega a `/login`.
2. `refresh_workspaces` llena la sidebar y los iconos desde `/api/desk-layout`.
3. `ui_ctx.init()` trae `GET /api/ui-extensions` (slots, dashboards, widgets, web).
4. `theme_ctx.init()` restaura el tema guardado y luego reconcilia con `/api/themes`.

En `/login` como invitado no se hace nada de eso: solo `theme_ctx.init_local()`,
porque los tres endpoints responderían 401 y llenarían la consola de ruido.

## Estilos

`desk.css` se compila desde `style/tailwind.css` y se sirve en `/static/desk.css`.
El servidor lo incrusta con `DESK_CSS` bajo la feature `ssr`; el navegador lo
pide por HTTP en vez de llevar una segunda copia dentro del wasm.

Siguiente: [Biblioteca de componentes](/0.2/frontend/componentes-ui/) y
[SSR e hidratación](/0.2/frontend/ssr-hidratacion/).
