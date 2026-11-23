---
title: Rust
description: Scaffold, wit-bindgen 0.62, build para wasm32-wasip2 y ejemplos de describe y doctype-event, con los errores más comunes.
---

Rust produce el componente más pequeño y con menos runtime: el compilador conoce
el WIT y no hay intérprete embebido.

## Scaffold

```bash
ferris new mi-app
ferris dev --app mi-app      # desde la raíz del bench
```

El scaffold crea el bench y la app:

```text
bench/
  config/ferris.toml       # [apps] wasm_dir = "apps"
  apps/mi-app/
    .cargo/config.toml     # target = wasm32-wasip2
    Cargo.toml             # cdylib + wit-bindgen 0.62
    rust-toolchain.toml    # canal y target fijados
    wit/ferris.wit         # copia del contrato
    src/lib.rs             # describe + exports del world
```

Con `ferris new --standalone mi-app` obtienes el layout antiguo
(`mi-app/config/ferris.toml`, `wasm_dir = "plugins"`).

`ferris new` es opcional: puedes montar el proyecto a mano. Lo que no es
opcional es el WIT exacto.

## Cargo

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "0.62"
serde_json = "1"        # solo si analizas el JSON de `doc.data`
```

```toml
# .cargo/config.toml
[build]
target = "wasm32-wasip2"
```

El target `wasm32-wasip2` produce un componente directamente; no hace falta
`wasm-tools`.

## Bindings

```rust
wit_bindgen::generate!({
    world: "ferris-app",
    path: "wit/ferris.wit",
});

use ferris::framework::{descriptor, types};
```

La macro genera los tipos del contrato (`descriptor::Descriptor`,
`types::Error`, `data::Doc`, …) y un trait `Guest` con los nueve exports.

## `describe()` mínimo

```rust
struct App;

impl Guest for App {
    fn describe() -> Result<descriptor::Descriptor, types::Error> {
        Ok(descriptor::Descriptor {
            // Solo las específicas: las primordiales ya están concedidas.
            capabilities: vec![],
            routes: vec![descriptor::Route {
                id: "api".to_string(),
                method: "*".to_string(),
                path: "/notas".to_string(),
                kind: descriptor::RouteKind::Http,
                auth: Some(types::RouteAuth::Session),
                body_limit: Some(256 * 1024),
                tls_server: None,
                listener: None,
            }],
            auth_mode: types::RouteAuth::Session,
            http_policy: None,
            tls_client: None,
            tls_server: None,
            doctypes: vec![descriptor::Doctype {
                name: "Nota".to_string(),
                is_submittable: false,
                is_single: false,
                allow_submit: false,
                allow_cancel: false,
                allow_amend: false,
                allow_delete: true,
                allow_copy: true,
                allow_print: true,
                allow_rename: false,
                in_calendar: false,
                in_kanban: false,
                in_gantt: false,
                in_tree_view: false,
                in_report_view: false,
                view: descriptor::DocView::Form,
                fields: vec![
                    descriptor::Field::Name("titulo".to_string()),
                    descriptor::Field::Name("cuerpo".to_string()),
                ],
                indexes: vec![],
                list_default_order: Some("titulo asc".to_string()),
            }],
            themes: vec![],
            folders: vec![],
            workspaces: vec![],
            methods: vec![],
            ui_extensions: None,
            dashboards: None,
            widgets: None,
            website: None,
            assets: None,
            subscriptions: None,
            config: None,
            plugin_version: Some("0.1.0".to_string()),
            requires: None,
        })
    }

    // Aquí van los otros ocho exports del trait (handle-request, …, ui-widget).
}
```

Los records generados no implementan `Default`: cada campo se escribe.

## Un `doctype-event` en el mismo `impl`

```rust
fn doctype_event(
    event: String,
    doctype: String,
    name: String,
    data: String,
) -> Result<(), Error> {
    if event == "validate" && doctype == "Nota" {
        let doc: serde_json::Value = serde_json::from_str(&data)
            .map_err(|e| types::Error::ValidationFailed(e.to_string()))?;
        let titulo = doc["titulo"].as_str().unwrap_or_default();
        if titulo.trim().is_empty() {
            // 422 y la fila no se escribe.
            return Err(types::Error::ValidationFailed(
                "el título es obligatorio".to_string(),
            ));
        }
    }
    Ok(())
}
```

En un punto `before-*`, devolver `Err` aborta; en el resto, el documento ya está
persistido. La tabla completa está en [ciclo de vida](/apps/ciclo-de-vida/).

## Un `handle-request` en el mismo `impl`

```rust
fn handle_request(
    route_id: String,
    req: HttpRequest,
) -> Result<Response, Error> {
    if route_id != "api" {
        return Err(types::Error::NotFound(route_id));
    }
    if req.method != "GET" {
        return Ok(Response {
            status: 405,
            headers: vec![("allow".to_string(), "GET".to_string())],
            body: b"method not allowed".to_vec(),
        });
    }
    Ok(Response {
        status: 200,
        headers: vec![("content-type".to_string(), "application/json".to_string())],
        body: br#"{"ok":true}"#.to_vec(),
    })
}
```

`req.path` es lo que sigue al prefijo; `req.query` llega sin `?`. El host filtra
las cabeceras que no debe devolver el guest.

## Build

```bash
cargo build --target wasm32-wasip2 --release
```

Salida: `target/wasm32-wasip2/release/<nombre_del_crate>.wasm`. El crate usa
guiones bajos (`mi-app` → `mi_app.wasm`); la app se llama como el paquete que
publiques.

```bash
ferris dev --app mi-app    # desarrolla: compila, carga y recarga al cambiar
ferris build --app mi-app  # paquete de catálogo en apps/mi-app/
```

No necesitas `ferris build` antes de `ferris dev`: el servidor de desarrollo
compila el componente que carga.

## Errores comunes

| Error | Causa | Arreglo |
|---|---|---|
| `can't find crate for core` | falta el target | `rustup target add wasm32-wasip2` |
| el `.wasm` no es un componente | compilaste sin `wasm32-wasip2` | usa el target o `ferris build` |
| `not a cdylib` / no hay `.wasm` | falta `crate-type` | añade `crate-type = ["cdylib"]` |
| falta un export | el trait `Guest` no está completo | implementa los nueve o devuelve error en los que no uses |
| el host no instancia | `wit/ferris.wit` no es el contrato | cópialo de nuevo, sin editar |
| `permission-denied` | capacidad específica sin declarar | añádela a `capabilities` |

:::caution[No implementes `Guest` a medias]
El trait tiene un método por export. Si falta uno, el crate no compila; si tu
editor solo te muestra dos, es que el resto está en otra parte del `impl`. Los
que no uses deben devolver un error tipado, no quedar vacíos.
:::

## Comprobarlo

```bash
wasm-tools validate target/wasm32-wasip2/release/mi_app.wasm
wasm-tools component wit target/wasm32-wasip2/release/mi_app.wasm | head -20
curl -s localhost:8000/plugins/mi-app | jq '.routes, .doctypes'
```
