---
title: Primeros pasos
description: "El recorrido común para cualquier lenguaje: copiar el WIT, generar
  bindings, implementar describe y un handler, construir, validar y cargar el
  componente."
slug: 0.2/apps/getting-started
---

Este recorrido es el mismo en todos los lenguajes. Solo cambian las dos
herramientas: la que genera los bindings y la que produce el componente. Si ya
tienes un `.wasm` que implementa el world, salta directamente al paso 7.

## Lo que necesitas

El contrato (`wit/ferris.wit`), un toolchain de componentes, `wasm-tools` y un
host en marcha (`ferris serve`, `ferris run` o `ferris dev`). `wasm-tools` es la
única herramienta común a todos los lenguajes:

```bash
wasm-tools validate mi-app.wasm
wasm-tools component wit mi-app.wasm
```

La segunda orden imprime el world del componente. Debe listar los imports
`ferris:framework/*@0.2.0` y los ocho exports; si no, el binario no es el que el
host espera.

## Paso 1 — Obtén el contrato

Copia `ferris.wit` desde la instalación del host o desde el scaffold de
`ferris new`:

```text
mi-app/
  wit/
    ferris.wit      # copia exacta; no lo edites
```

El fichero es la fuente de verdad del contrato. No lo adaptes, no lo recortes y
no le cambies el `package`: el host enlaza exactamente las interfaces de
`ferris:framework@0.2.0`.

:::caution[No inventes el WIT]
Un contrato parafraseado produce un componente que compila y no instancia. Si
dudas de un tipo, lee el fichero; la página [El contrato WIT](/0.2/apps/wit/) lo
explica, pero el `.wit` manda.
:::

## Paso 2 — Genera los bindings

Cada toolchain tiene su orden. La idea es siempre la misma: leer `wit/ferris.wit`,
elegir el world `ferris-app` y generar tipos y esqueletos de exportación en tu
lenguaje.

| Lenguaje | Orden |
|---|---|
| Rust | `wit-bindgen` en `build.rs` o macro; ver [Rust](/0.2/apps/languages/rust/) |
| Python | `componentize-py -d wit -w ferris-app bindings <modulo>` |
| JS/TS | `npx jco scaffold mi-app --wit wit/ferris.wit` |
| Go | `componentize-go --world ferris-app bindings --format` |
| Otros | `wit-bindgen <lenguaje> wit --world ferris-app` |

Los bindings generan dos cosas: los **tipos** del contrato (records, variantes,
enums) y los **stubs** de los exports que debes implementar. Los imports
(`types`, `data`, `io`, `mqtt`, `platform`, `descriptor`) aparecen como funciones
y tipos que usas.

## Paso 3 — Implementa `describe()`

`describe()` es el único export que el host llama siempre. Devuelve el
`descriptor`; empieza por lo mínimo y crece después:

```wit
// Forma del valor devuelto, no código de tu lenguaje.
capabilities: []
routes: []
auth-mode: session
doctypes: []
themes: []
folders: []
workspaces: []
methods: []
```

Eso ya es una app válida: se carga y no expone nada. A partir de ahí añade
secciones. Un `describe()` mínimo con un DocType y una ruta se ve así en el
contrato:

```wit
doctypes: [{
    name: "Nota",
    is-submittable: false,
    is-single: false,
    allow-delete: true,
    allow-copy: true,
    allow-print: true,
    view: form,
    fields: [name("titulo"), name("cuerpo")],
    indexes: [],
}],
routes: [{
    id: "api",
    method: "*",
    path: "/notas",
    kind: http,
    auth: session,
}]
```

`auth` se puede omitir: entonces hereda `auth-mode`. Consulta
[descriptor](/0.2/apps/descriptor/) para cada campo y sus valores por defecto.

## Paso 4 — Implementa un handler

Elige uno de los dos caminos según lo que quieras demostrar.

### Una ruta HTTP

```text
handle-request(route-id, petición) -> respuesta
```

* `route-id` es el `id` que declaraste, o uno reservado (`plugins`, `api`,
  `page`, `method:<name>`).
* `req.path` (el campo `path` de la petición) es lo que sigue al prefijo;
  analízalo tú. Los nombres exactos de los parámetros los fija tu binding.
* La respuesta lleva `status`, `headers` y `body`.

Devuelve `404` para lo que no reconozcas. El host respeta tu status y filtra
solo cabeceras hop-by-hop y las que posee el framework.

### Un evento de DocType

```text
doctype-event(event, doctype, name, data) -> resultado
```

`data` es el documento en JSON canónico. En un punto `before-*`, devolver un
error **aborta** la escritura; en el resto, el documento ya está persistido. La
tabla completa está en [ciclo de vida](/0.2/apps/ciclo-de-vida/).

:::tip[Empieza por `validate`]
Un `doctype-event` que rechaza un documento inválido es la forma más rápida de
comprobar que el contrato, los bindings y la carga funcionan de extremo a
extremo.
:::

## Paso 5 — Construye el `.wasm`

El resultado debe ser un **componente**, no un módulo core. El nombre del
fichero será el nombre de la app.

| Lenguaje | Salida típica |
|---|---|
| Rust | `target/wasm32-wasip2/release/<crate>.wasm` |
| Python | `app.wasm` (`-o app.wasm`) |
| JS/TS | `dist/<nombre>.wasm` del proyecto generado |
| Go | `main.wasm` |

Los comandos exactos, con sus banderas, están en [Construir](/0.2/apps/building/).

## Paso 6 — Valida

```bash
wasm-tools validate mi-app.wasm
wasm-tools component wit mi-app.wasm
```

Criterios de aceptación:

* valida sin errores y la salida importa `ferris:framework/*@0.2.0` (el world
  sintetizado puede llamarse `root`; lo que importa son las interfaces);
* están los ocho exports (`describe`, `handle-request`, `doctype-event`,
  `handle-stream`, `handle-stream-event`, `handle-job`, `ui-asset`,
  `ui-widget`);
* no hay imports fuera del contrato (WASI permitido, nada de SQL ni sockets).

## Paso 7 — Cárgalo

Deja el componente en `plugins/mi-app.wasm` (o en
`plugins/mi-app/mi-app.wasm`); la forma plana gana si existen las dos. Después
declara la app en la configuración del host:

```toml
[apps]
wasm_dir = "plugins"
enabled = []        # vacío = todas las que encuentre
```

`enabled` es una lista de permitidos. Un nombre listado sin fichero es un error
de arranque: el host no ignora una app que le pidieron servir.

## Paso 8 — Comprueba que está viva

```bash
curl -s localhost:8000/plugins/mi-app | jq '{capabilities, routes, doctypes, methods}'
```

Si responde `404`, el host no encontró el componente o no pudo instanciarlo. Si
responde el descriptor, la app está cargada y la superficie es la que declaró.
Prueba después la ruta y el evento:

```bash
curl -s localhost:8000/plugins/mi-app/notas
curl -s -X POST localhost:8000/api/resource/Nota -H 'content-type: application/json' \
  -d '{"titulo": "Primera"}'
```

## Estructura de proyecto, sin elegir lenguaje

| Lenguaje | Estructura típica |
|---|---|
| Rust | `Cargo.toml`, `src/lib.rs`, `wit/ferris.wit`, `plugins/` |
| Python | `mi_app.py`, `wit/ferris.wit`, `app.wasm` |
| JS/TS | `package.json`, `src/`, `wit/`, `types/`, `dist/` |
| Go | `go.mod`, `main.go`, `wit/`, `main.wasm` |
| C/C++/C#/Zig | el manifiesto de tu build, `wit/` y el `.wasm` final |

Nada de eso lo impone el host: solo importan el componente y su nombre. La
página [Lenguajes](/0.2/apps/languages/) compara los toolchains.

## Errores de la primera vez

| Síntoma | Causa habitual |
|---|---|
| `404` en `/plugins/<app>` | el fichero no está en `plugins/` o el nombre no coincide |
| fallo al instanciar | es un módulo core, no un componente, o el world no es el contrato |
| `403` con `permission-denied` | falta una capacidad específica en `describe()` |
| la ruta responde `404` | no está en `routes`, o choca con un prefijo del framework |
| el evento no llega | el DocType no es el que declaraste, o el punto no se emite |

Sigue en [Depuración](/0.2/apps/depuracion/) para el detalle de cada uno.
