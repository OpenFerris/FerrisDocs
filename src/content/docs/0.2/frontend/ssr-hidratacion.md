---
title: SSR e hidratación
description: Cómo el servidor renderiza con DocStore::Server, cómo hidrata el
  cliente con DocStore::Client y qué reglas mantienen ambos lados idénticos.
slug: 0.2/frontend/ssr-hidratacion
---

El Desk se renderiza en el servidor y se **hidrata** en el navegador. No hay dos
aplicaciones: hay dos mitades del mismo árbol de componentes, y la regla es que la
primera pasada del cliente produzca exactamente el mismo DOM que el servidor.

## El documento del servidor

`DeskShell` (`ferris-web/src/shell.rs`) es el documento HTML completo:

```rust
view! {
    <!DOCTYPE html>
    <html lang="en">
        <head>
            <MetaTags />
            <meta name=BOOTSTRAP_USER_META content=bootstrap />
            <link rel="stylesheet" href="/static/desk.css" />
            <HydrationScripts options=options.clone() />
            <AutoReload options=options />
        </head>
        <body>
            <Router>
                <DeskApp />
            </Router>
        </body>
    </html>
}
```

* `<MetaTags />` va **primero**: emite el marcador `<!--HEAD-->` que
  `leptos_meta` rellena después. Si se coloca al final, no se emite y la
  hidratación entra en pánico buscándolo.
* La identidad viaja en `<meta name="ferris-user" content="…">` con el `WebUser`
  serializado. Un `<meta>` queda fuera del `script-src` del CSP; un `<script>`
  inline no.
* `leptos_axum` inyecta `LeptosOptions` durante el render de una petición; en el
  render de arranque (`generate_route_list`) se cae al mismo valor por defecto.

## Dos DocStore, una fachada

```rust
pub enum DocStore {
    #[cfg(feature = "ssr")]
    Server(DocStoreApi),
    Client,
}
```

`DocStore::runtime()` devuelve el servidor cuando la feature `ssr` está activa y
el cliente en cualquier otro caso. La bifurcación es por **feature**, no por
`target_arch`: así un `cargo check` nativo del Desk no arrastra el motor entero
solo para typechequear una vista, y el wasm nunca enlaza `ferris-api`.

Cada método tiene dos ramas y una sola firma, así que una vista no sabe —ni
puede— saber en qué lado corre. Lo que cambia es el transporte: en SSR el motor
responde en proceso; en el navegador, HTTP contra `/api/*`.

:::danger
Una vista que llame a `fetch` o `reqwest` directamente rompe la paridad: el
servidor pintaría unos datos y el navegador otros, con dos estructuras de DOM
distintas. Toda lectura y escritura pasa por `DocStore`.
:::

## La hidratación

`ferris-web/src/hydrate.rs` exporta `hydrate()` desde la **librería** (no desde un
binario): `ferris dev --hot-reload frontend` compila con `--lib`, y así el glue de
wasm-bindgen ve el export.

```rust
#[wasm_bindgen]
pub fn hydrate() {
    HYDRATE_ONCE.call_once(|| {
        console_error_panic_hook::set_once();
        use_scroll_lock::init();      // antes de cualquier <script> de componente
        let user = bootstrap_user();  // lee <meta name="ferris-user">
        leptos::mount::hydrate_body(move || {
            provide_context(RwSignal::new(user));
            view! { <Router><DeskApp /></Router> }
        });
    });
}
```

* `HYDRATE_ONCE` hace la entrada idempotente. Dos árboles sobre el mismo DOM
  duplicarían cada listener y cada petición por clic.
* `bootstrap_user` lee el `<meta>` que el servidor escribió; si falta o no parsea,
  cae al invitado. `DeskApp` revalida luego con `/api/auth/session` y solo
  redirige a `/login` si la sesión se perdió de verdad.
* `use_scroll_lock::init()` registra `window.ScrollLock` antes de que corran los
  `<script>` inline de dropdowns, diálogos y hojas.

## Paridad: cómo se consigue

Tres reglas hacen el trabajo:

1. **El primer render no depende de datos que solo existan en el cliente.** El
   feed de extensiones (`/api/ui-extensions`) está vacío en ambos lados, así que
   los dos pintan el mismo placeholder y el cliente lo rellena después.
2. **Los estados de carga empiezan en "cargando".** Si `loading` arrancara en
   `false`, la primera pasada de hidratación pintaría el estado vacío en el hueco
   que el servidor reservó al skeleton, y la estructura saltaría.
3. **Nada de `cfg(feature = "hydrate")` en una vista.** Las ramas por plataforma
   viven en `api/`, `hydrate.rs` o dentro de un efecto, nunca en el `view!`.

Cuando un componente necesita el navegador (elemento montado, `window`,
`localStorage`), lo hace en un `Effect`, que no corre en SSR. El cuerpo del widget
de una app es el ejemplo canónico: el servidor emite un marcador y el cliente
monta el elemento real.

## CSP y nonce

`ferris-server::router::security` genera una política por respuesta con un nonce
nuevo:

```text
default-src 'self';
script-src 'self' 'nonce-…' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://tile.openstreetmap.org;
connect-src 'self' ws: wss:;
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

El middleware guarda el nonce en `CspNonce` (una extensión de la petición) y
`provide_desk_context` lo mete en el contexto de Leptos, sustituyendo el que
generó `leptos_axum` internamente. Sin eso, el `script-src` estricto bloquearía el
bootstrap inline y el Desk nunca hidrataría.

Los componentes que crean un `<script>` **después** de hidratar (diálogos,
popovers, selects, menús) reutilizan `ferris_web_ui::csp_nonce()`. En el servidor
lee el nonce del contexto; en el cliente lo lee una vez del primer
`script[nonce]` del documento y lo cachea.

:::caution
Escribir un `<script>` inline sin nonce no da error de compilación: el navegador lo
descarta y el componente "no hace nada". Si un overlay no se abre, sospecha del
nonce antes que del componente.
:::

## Qué no cruza al navegador

* `DESK_CSS` está bajo `ssr`: el navegador pide `/static/desk.css`.
* `preview_assets` y `vendor_assets` son solo nativos: el navegador los pide por
  HTTP.
* `doctypes`, `website` y `workspaces` se declaran bajo `ssr` porque necesitan el
  registro de `ferris-schema`.
* La feature `wasm-runtime` (wasmtime, axum, tokio) solo la usa
  `src/bin/ssr.rs`.

## Comprobar los tres modos

```bash
cargo check -p ferris-web --features ssr
cargo check -p ferris-web --features hydrate --target wasm32-unknown-unknown
cargo check -p ferris-web --bin ferris-web-ssr --features ssr,wasm-runtime
```

El **binario** no entra en `--all-targets`, por eso necesita su propio comando. Es
el servidor SSR del propio Desk y `ferris dev --hot-reload front|both` lo ejecuta,
así que un tipo que solo él toca no compila en ningún otro gate.

`ferris-server` es además quien filtra esa tabla: el catch-all `/*rest` existe en
la lista del cliente, pero en el router de axum solo se registran concretamente
las rutas que una app declaró de verdad. Por eso una URL desconocida da 404 en una
carga directa y el catch-all solo actúa ya dentro del SPA.

Siguiente: [Widgets](/0.2/guias/widgets/) y [Depuración de plugins](/0.2/apps/depuracion/).
