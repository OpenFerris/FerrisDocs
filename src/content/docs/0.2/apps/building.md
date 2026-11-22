---
title: Construir el componente
description: Comandos exactos por toolchain para producir un componente del
  world ferris-app, validarlo y comprobarlo antes de cargarlo.
slug: 0.2/apps/building
---

El host solo acepta un **componente WebAssembly** cuyo world sea
`ferris:framework@0.2.0` / `ferris-app`. Un módulo core, un binario nativo o un
componente de otro world no instancian.

Elige tu toolchain; el resto del recorrido es idéntico.

## Matriz de toolchains

| Lenguaje | Herramienta | Comando de build | Salida |
|---|---|---|---|
| Rust | `wit-bindgen` 0.62 | `cargo build --target wasm32-wasip2 --release` | `target/wasm32-wasip2/release/<crate>.wasm` |
| Python 3.10+ | `componentize-py` | `componentize-py … componentize` | `app.wasm` |
| JS/TS | `jco` + `componentize-js` | `npm run build` | el `.wasm` del proyecto |
| Go 1.27.1+ | `componentize-go` | `componentize-go --world ferris-app build` | `main.wasm` |
| C/C++/C#/Zig | `wit-bindgen` + `wasm-tools` | `wasm-tools component new` | el `.wasm` que nombres |

## Rust

`wit-bindgen = "0.62"` genera los tipos y el trait de exports del world. El crate
es un `cdylib` para `wasm32-wasip2`:

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "0.62"
```

```bash
cargo build --target wasm32-wasip2 --release
```

Salida: `target/wasm32-wasip2/release/<nombre_del_crate>.wasm`. El nombre del
crate usa guiones bajos donde el paquete usa guiones (`mi-app` →
`mi_app.wasm`); el nombre de la **app** es el que le des al fichero en
`plugins/`. En perfil de desarrollo la ruta es `debug/`.

`ferris build` hace lo mismo y copia el resultado a `plugins/<paquete>.wasm`.
Guía completa: [Rust](/0.2/apps/languages/rust/).

## Python 3.10+

```bash
pip install componentize-py
componentize-py -d wit -w ferris-app bindings mi_app
```

Esto genera los bindings (tipos y clases de exportación) en el directorio que
nombres. Implementa los exports y empaqueta:

```bash
componentize-py -d wit -w ferris-app componentize --stub-wasi mi_app -o app.wasm
```

* `-d wit` apunta al directorio que contiene `ferris.wit`;
* `-w ferris-app` selecciona el world;
* `--stub-wasi` sustituye las importaciones WASI que el host no usa por stubs, y
  evita exigir un adaptador;
* `-o app.wasm` es el componente final.

El módulo debe estar en el directorio de trabajo (o en uno que `PYTHONPATH`
incluya). Detalle y limitaciones: [Python](/0.2/apps/languages/python/).

## JavaScript y TypeScript

Node 22.12 o superior:

```bash
npm i -D @bytecodealliance/jco
npx jco scaffold mi-app --wit wit/ferris.wit
cd mi-app
npm install
npm run build
```

`jco scaffold` acepta un fichero WIT o un directorio de paquetes (`--wit wit`).
El proyecto generado incluye declaraciones de tipos, un esqueleto de
implementación y los scripts de build; `npm run build` produce el componente con
`componentize-js`. La ruta exacta la imprime el propio proyecto (habitualmente
`dist/<nombre>.wasm`).

Guía completa: [JavaScript y TypeScript](/0.2/apps/languages/javascript/).

## Go 1.27.1+

```bash
go install github.com/bytecodealliance/componentize-go@latest

componentize-go --world ferris-app bindings --format
go mod tidy
componentize-go --world ferris-app build
```

* `bindings --format` genera los paquetes de bindings y los formatea;
* `go mod tidy` resuelve las dependencias que esos paquetes declaran;
* `build` compila el módulo a un componente.

Salida: `main.wasm`. El world se puede fijar también en un
`componentize-go.toml`; si pasas `--world` en la línea de órdenes, ese valor
manda. Guía completa: [Go](/0.2/apps/languages/go/).

## C, C++, C#, Zig y otros

Cualquier toolchain que produzca un componente del world `ferris-app` sirve. El
camino habitual es:

1. generar bindings C con `wit-bindgen c wit --world ferris-app`;
2. compilar a un módulo core wasm (por ejemplo, `wasm32-wasi`);
3. convertirlo en componente:

```bash
wasm-tools component new core.wasm -o mi-app.wasm \
  --adapt wasi_snapshot_preview1=<ruta>/wasi_snapshot_preview1.reactor.wasm
```

El adaptador traduce `wasi_snapshot_preview1` al world de WASI preview 2. Solo
hace falta si tu módulo importa WASI preview 1; un módulo que ya es un componente
no se vuelve a envolver.

Requisitos del resultado, sea cual sea el lenguaje:

* exports del world `ferris-app`, con los nombres exactos;
* imports del contrato (`ferris:framework/*`) y, si hace falta, WASI;
* sin imports de host propietarios (`wasi:sql`, sockets directos, etc.);
* memoria y pila razonables para el presupuesto del host.

Guía completa: [Otros lenguajes](/0.2/apps/languages/other/).

## Validación

Dos comprobaciones, siempre:

```bash
wasm-tools validate mi-app.wasm
wasm-tools component wit mi-app.wasm
```

La primera comprueba la estructura del componente. La segunda imprime su world:
debe listar los imports de `ferris:framework` con la versión `0.2.0` y los ocho
exports. El world sintetizado puede llamarse `root`; el nombre del world no es lo
que se valida, sino las interfaces y las firmas.

```bash
# ¿es un componente y no un módulo core?
wasm-tools print mi-app.wasm | head -5
```

## Criterios de aceptación

Antes de copiar el fichero a `plugins/`:

* \[ ] `wasm-tools validate` termina sin error.
* \[ ] `wasm-tools component wit` muestra los imports `ferris:framework/*@0.2.0`
  y los ocho exports del contrato.
* \[ ] están `describe`, `handle-request`, `doctype-event`, `handle-stream`,
  `handle-stream-event`, `handle-job`, `ui-asset` y `ui-widget` (los que no
  uses pueden devolver un error tipado, pero deben existir);
* \[ ] el tamaño es razonable para el runtime (un runtime embebido, como el de
  JavaScript, pesa varios MB antes de tu código);
* \[ ] el fichero se llama como la app que quieres publicar;
* \[ ] no hay rutas absolutas del sistema de ficheros del host en tu código: el
  guest solo ve `/world`.

## Después del build

```text
plugins/mi-app.wasm
```

```toml
[apps]
wasm_dir = "plugins"
enabled = []
```

```bash
curl -s localhost:8000/plugins/mi-app | jq .
```

Si el descriptor responde, el componente está bien construido y bien enlazado. Si
el host responde `404`, revisa [Depuración](/0.2/apps/depuracion/): el fallo está en
la carga, no en tu lógica.

:::caution[Un `.wasm` válido no es una app válida]
La validación estructural no ejecuta `describe()`. Un componente perfectamente
válido puede fallar al instanciar por un import que el host no ofrece o por un
`describe()` que devuelve un error. La prueba real es `/plugins/<app>`.
:::
