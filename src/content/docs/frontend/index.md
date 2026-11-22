---
title: El frontend de Ferris
description: Los tres crates del Desk, la dirección de dependencias entre ellos y cómo elegir qué mirar primero.
---

El Desk es una aplicación Leptos 0.8 que se renderiza en el servidor y se hidrata
en el navegador. Está partida en **tres crates** con una dirección de dependencias
estricta, y esa partición es lo que mantiene el tiempo de compilación y el tamaño
del bundle bajo control.

```text
ferris-web  →  ferris-web-ui  →  ferris-web-shared
   (Desk)      (componentes)      (contrato y helpers)
```

Nunca se invierte. `ferris-web` reexporta los otros dos bajo sus rutas de módulo
(`crate::components::ui::…`), así que una vista sigue compilando cuando un
componente se muda de crate.

## Qué vive en cada crate

| Crate | Contiene | No contiene |
|---|---|---|
| `ferris-web-shared` | DTOs del contrato, helpers de metadatos, tablas de locale, percent-encoding (`route`) y escapado de HTML (`html`) | Leptos, `web-sys`, nada de red |
| `ferris-web-ui` | ~90 componentes en `components/ui/`, hooks en `components/hooks/`, `catalog` con las clases `.ferris-*` | rutas, fetch, puente al motor |
| `ferris-web` | `app/` (shell, estado, rutas), `views/`, `api/` (`DocStore`, cliente y servidor), `desk/`, `ext/`, `theme.rs` | primitivas visuales nuevas |

`ferris-web-shared` es el único de los tres que compila sin Leptos: es la parte
que el servidor nativo y el módulo wasm comparten tal cual.

## Las features del crate del Desk

`ferris-web/Cargo.toml` no enciende nada por defecto:

| Feature | Qué añade | Para qué |
|---|---|---|
| *(nada)* | Leptos + `ferris-schema/contract` | typecheck neutral del Desk |
| `ssr` | `ferris-core`, `ferris-db`, `ferris-api`, `ferris-document`, `ferris-auth`, `leptos_axum` | render en el servidor con el motor en proceso |
| `hydrate` | `leptos/hydrate`, `ferris-web-ui/hydrate` | bundle wasm del navegador |
| `wasm-runtime` | `ssr` + `ferris-wasm`, `axum`, `tokio`, `tower-http` | solo el binario `ferris-web-ssr` |

```toml
# ferris-web/Cargo.toml (extracto)
[features]
default = []
ssr = ["dep:ferris-api", "ferris-schema/native", "leptos/ssr", "ferris-web-ui/ssr"]
hydrate = ["leptos/hydrate", "ferris-web-ui/hydrate"]
wasm-runtime = ["ssr", "dep:ferris-wasm", "dep:axum", "dep:tokio"]
```

:::caution
`wasm-runtime` está fuera de `ssr` a propósito. `ferris-wasm` arrastra wasmtime y
cranelift (~40 crates); si estuviera en el conjunto por defecto, cada `cargo
check` del Desk cargaría ese grafo entero. La librería nunca toca wasmtime: solo
`src/bin/ssr.rs` lo hace.
:::

## Los módulos de `ferris-web`

```text
ferris-web/src/
  app/          shell de la aplicación: rutas, estado, breadcrumbs, móvil
  views/        páginas: form, list, kanban, calendar, report, dashboard, widget_host, settings
  api/          DocStore (SSR/cliente), DTOs, hooks (list, mutation, engagement)
  desk/         chrome: sidebar, top bar, búsqueda global, notificaciones, login, tema
  ext/          extensiones de apps: UiCtx, slots OpenUI, montaje de elementos
  components/   reexport de ferris-web-ui + vistas compuestas (form, list, common)
  shell.rs      documento HTML completo del SSR
  theme.rs      temas en el cliente y pintado de tokens
```

## El puerto único de datos

Toda vista habla con `DocStore`, nunca con `fetch` ni con `reqwest`:

```rust
use crate::api::{DocStore, ListParams};

async fn cargar(doctype: &str) {
    let Ok(store) = DocStore::runtime() else { return };
    let meta = store.meta(doctype).await;
    let rows = store.list(doctype, &ListParams::default()).await;
    // …
}
```

`DocStore::runtime()` devuelve `DocStore::Server` cuando la feature `ssr` está
activa (motor en proceso, sin HTTP contra sí mismo) y `DocStore::Client` en
cualquier otro caso. La bifurcación es por **feature**, no por `target_arch`: un
`cargo check` nativo del Desk no necesita el motor si nadie pidió SSR.

:::danger
Una vista que llame a `fetch` directamente rompe la paridad SSR/hidratación: el
servidor pintaría una cosa y el navegador otra. Ver
[SSR e hidratación](/frontend/ssr-hidratacion/).
:::

## Por dónde empezar

- Si vas a **usar** el Desk: [El Desk](/frontend/desk/) y
  [Formularios](/frontend/formularios/).
- Si vas a **tocar la interfaz**: [Biblioteca de componentes](/frontend/componentes-ui/)
  y [Theming](/frontend/theming/).
- Si vas a **extenderlo desde una app**: [Widgets](/guias/widgets/) y
  [Temas y UI](/guias/temas-y-ui/).

Los gates del frontend se ejecutan dentro del contenedor, nunca en el host:

```bash
cargo check -p ferris-web --features hydrate --target wasm32-unknown-unknown
cargo check -p ferris-web --features ssr
cargo check -p ferris-web --bin ferris-web-ssr --features ssr,wasm-runtime
cd ferris-web && node_modules/.bin/tailwindcss -i style/tailwind.css -o style/desk.css --minify
```

:::note
El *binario* SSR no entra en `--all-targets`: necesita `ssr,wasm-runtime`, que no
son features por defecto. Si tocas el puente SSR, ese gate es obligatorio. Lo
mismo con `desk.css` si cambiaste clases.
:::

## Versiones

Ferris `0.3.0`, Leptos `0.8`, Rust `1.98.1`. La edición es 2024.
