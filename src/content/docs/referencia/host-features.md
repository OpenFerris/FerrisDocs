---
title: Features del host
description: Qué significa cada feature de Cargo, cuáles vienen por defecto, cómo se publican al runtime y cómo detectar un desajuste.
---

Un subsistema de Ferris es una **feature de Cargo**, no un interruptor de
configuración. Si el binario no la compiló, ninguna configuración la añade: la
respuesta a "¿por qué no hay `print`?" es el comando de build, no `ferris.toml`.

## Nombres y defaults

`ferris-server` y `ferris-cli` exponen el mismo conjunto, con los mismos nombres.

| Feature | Añade | Por defecto |
|---|---|---|
| `api` | Rutas `/api/*`; es la base, no se apaga | siempre |
| `web` | Desk (Leptos, SSR) | sí |
| `realtime` | Rol socket.io y eventos | sí |
| `jobs` | Worker y cola durable | sí |
| `scheduler` | Rol de cron | sí |
| `email` | Hub de correo, cuentas y worker | sí |
| `files` | `/files`, `/api/files`, DocType `File` | sí |
| `print` | DocTypes y rutas de impresión | sí |
| `report` | DocTypes y rutas de informes | sí |
| `integrations` | DocTypes y hooks de OAuth/webhook | sí |
| `wasm` | Host wasmtime, `/plugins`, métodos de app | sí |
| `full` | Todas las anteriores | — |

Los builds documentados:

```bash
# Por defecto: todos los verticales
cargo build -p ferris-cli --release

# Mínimo: API + Desk
cargo build -p ferris-cli --release --no-default-features --features api,web

# Todo
cargo build -p ferris-cli --release --features full
```

## El gate de configuración

`[features]` es un interruptor de ejecución, no un compilador:

```toml
[features]
print = true    # gate: permite el subsistema SI se compiló
```

- `[features] x = false` es autoritativo: quita el rol/rutas aunque estén
  compilados.
- `[features] x = true` **nunca añade** lo que el binario no tiene, y sobre un
  binario sin esa feature es un error de arranque, nunca un skip silencioso.

El mensaje es explícito y nombra el comando:

```text
invalid config value for [features]: `print` is enabled, but this `ferris`
binary was built without it; rebuild ferris with `--features print`
(or `--features full` for every subsystem), e.g.
`cargo build -p ferris-cli --features print`
```

## Cómo llega la decisión al runtime

`cfg!(feature = …)` solo existe en tiempo de compilación; dos consumidores lo
necesitan en tiempo de ejecución:

1. **Los guests WIT** llaman a `platform::features()` y esconden sus afinidades
   (panel de impresión, realtime) en vez de llamar a una importación que
   respondería `unsupported`.
2. **`ferris doctor`** imprime el conjunto compilado junto al configurado y falla
   si se contradicen.

La fuente única es `ferris_core::host_features`:

- `ferris-server` la rellena al arrancar con `HostFeatures::new([...])` a partir
  de sus `cfg!` y la instala en un `OnceLock`.
- `install` es *first install wins*: un segundo intento devuelve `false` (un
  segundo boot en el proceso es un error de programación, no un pánico).
- `is_enabled(name)` responde `false` si nada se instaló: "no consta compilado"
  es la lectura segura.
- `ferris-cli/src/features.rs` lee ese conjunto, no sus propios `cfg!`, y es
  dueño del texto y de la comprobación de desajustes.

`ferris-server::server::validate_compiled_features` vuelve a validar la config
fusionada en el arranque, así que `serve`, `run`, `dev` y `doctor` no pueden
discrepar.

## Matriz mínima y completa

| Build | Configuración necesaria |
|---|---|
| `--features full` | Cualquiera; todos los gates pueden estar en `true` |
| Por defecto | Cualquiera |
| `--no-default-features --features api,web` | `[features] realtime/jobs/scheduler/email/files/print/report/integrations/wasm = false` |

Un build mínimo **no** se arregla relajando la comprobación: el scaffold activa
los verticales, y el operador debe apagar los que no compiló.

:::danger[Los roles no son features]
`[server] roles` es del servidor, no del CLI. `ferris serve --api` selecciona
rutas dentro de lo compilado; no compila nada. Un rol cuyo subsistema no se
compiló (o que `[features]` apagó) **no arranca**: se registra un warning y el
resto de roles sigue. Lo que sí falla el arranque es un `[features]` que pide algo
ausente.
:::

## Qué observa un cliente

Una feature apagada **elimina la ruta**: `/api/search` sin `search`,
`/api/print/*` sin `print` y `/api/report/*` sin `report` responden `404`. Un
`404` aquí significa "el operador lo apagó", no "no hay resultados".

## Comprobar

```bash
# El conjunto por defecto compila
cargo check --all-targets

# Si tocaste ferris-cli/server/wasm
cargo check-cli

# Matriz mínima y completa del CLI
cargo check -p ferris-cli --no-default-features --features api
cargo check -p ferris-cli --features full

# En un proyecto: matriz compilada vs configurada (crítico)
ferris doctor

# Informe del conjunto compilado
ferris info
ferris config show    # el conjunto va a stderr; stdout sigue siendo JSON
```

`ferris info` y `ferris config show` imprimen **interruptores**, nunca una
credencial, una clave ni una ruta de certificado.

## La mitad WIT

El contrato declara capacidades y rutas, no features de Cargo: WIT es estático.
Lo que cambia en tiempo de ejecución es la respuesta. Un guest debe preguntar
primero qué compiló el host:

```rust
let features = platform::features()?;
if !features.iter().any(|f| f == "print") {
    return Ok(text("print=absent".to_string()));
}
```

`platform::features()` no es un permiso: para eso está
`platform::grants()`.
