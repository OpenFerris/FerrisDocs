---
title: Features del host
description: Qué significa cada feature de Cargo, cuáles vienen por defecto,
  cómo se publican al runtime y cómo detectar un desajuste.
slug: 0.2/referencia/host-features
---

Un subsistema de Ferris es una **feature de Cargo**, no un interruptor de
configuración. Si el binario no la compiló, ninguna configuración la añade: la
respuesta a "¿por qué no hay MQTT?" es el comando de build, no `ferris.toml`.

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
| `mqtt` | Cliente MQTT nativo, interfaz WIT y rol | **no** |
| `full` | Todas las anteriores, `mqtt` incluida | — |

Los builds documentados:

```bash
# Por defecto: todo menos MQTT
cargo build -p ferris-cli --release

# Mínimo: API + Desk
cargo build -p ferris-cli --release --no-default-features --features api,web

# Por defecto + MQTT
cargo build -p ferris-cli --release --features mqtt

# Todo
cargo build -p ferris-cli --release --features full
```

## Gate de configuración frente a petición

Hay dos preguntas distintas y `ferris.toml` las separa:

```toml
[features]
mqtt = true      # gate: permite el subsistema SI se compiló

[mqtt]
enabled = true   # petición: arráncalo en esta instalación
```

* `[features] x = false` es autoritativo: quita el rol/rutas aunque estén
  compilados.
* `[features] x = true` **nunca añade** lo que el binario no tiene.
* `[mqtt] enabled = true` (o un broker/suscripción) es una **petición**. Sobre un
  binario sin `mqtt` es un error de arranque, nunca un skip silencioso.

El mensaje es explícito y nombra el comando:

```text
invalid config value for [mqtt]: `[mqtt]` asks for the `mqtt` subsystem, but
this `ferris` binary was built without it; rebuild ferris with `--features
mqtt` (or `--features full` for every subsystem), e.g.
`cargo build -p ferris-cli --features mqtt`
```

Un `[features] mqtt = true` a secas es un permiso, no una petición: una config por
defecto sigue siendo válida en un binario sin MQTT.

## Cómo llega la decisión al runtime

`cfg!(feature = …)` solo existe en tiempo de compilación; dos consumidores lo
necesitan en tiempo de ejecución:

1. **Los guests WIT** llaman a `platform::features()` y esconden sus afinidades
   (panel MQTT, realtime) en vez de llamar a una importación que respondería
   `unsupported`.
2. **`ferris doctor`** imprime el conjunto compilado junto al configurado y falla
   si se contradicen.

La fuente única es `ferris_core::host_features`:

* `ferris-server` la rellena al arrancar con `HostFeatures::new([...])` a partir
  de sus `cfg!` y la instala en un `OnceLock`.
* `install` es *first install wins*: un segundo intento devuelve `false` (un
  segundo boot en el proceso es un error de programación, no un pánico).
* `is_enabled(name)` responde `false` si nada se instaló: "no consta compilado"
  es la lectura segura.
* `ferris-cli/src/features.rs` lee ese conjunto, no sus propios `cfg!`, y es
  dueño del texto y de la comprobación de desajustes.

`ferris-server::server::validate_compiled_features` vuelve a validar la config
fusionada en el arranque, así que `serve`, `run`, `dev` y `doctor` no pueden
discrepar.

## Matriz mínima y completa

| Build | Configuración necesaria |
|---|---|
| `--features full` | Cualquiera; todos los gates pueden estar en `true` |
| Por defecto | `[mqtt]` ausente o `enabled = false` |
| `--no-default-features --features api,web` | `[features] realtime/jobs/scheduler/email/files/print/report/integrations/wasm/mqtt = false` |

Un build mínimo **no** se arregla relajando la comprobación: el scaffold activa
los verticales, y el operador debe apagar los que no compiló.

:::danger[Los roles no son features]
`[server] roles` es del servidor, no del CLI. `ferris serve --api` selecciona
rutas dentro de lo compilado; no compila nada. Un rol cuyo subsistema no se
compiló (o que `[features]` apagó) **no arranca**: se registra un warning y el
resto de roles sigue. Lo que sí falla el arranque es un `[features]`/`[mqtt]`
que pide algo ausente.
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

`ferris info` y `ferris config show` imprimen **interruptores**, nunca una URL de
broker, una credencial ni una ruta TLS.

## La mitad WIT

El contrato sigue declarando `mqtt` aunque el host no lo compile: WIT es estático.
Lo que cambia es la respuesta. Un guest debe preguntar primero:

```rust
let features = platform::features()?;
if !features.iter().any(|f| f == "mqtt") {
    return Ok(text("mqtt=absent".to_string()));
}
```

El scaffold de `ferris new` trae exactamente esa ruta (`/mqtt/ping`) como
ejemplo. `platform::features()` no es un permiso: para eso está
`platform::grants()`.
