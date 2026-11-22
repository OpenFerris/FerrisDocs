---
title: Features de compilación
description: "Matriz de features de Cargo y de [features] en tiempo de ejecución, defaults y fallo de arranque."
---

Ferris separa dos decisiones que se confunden con facilidad: **qué compiló el
binario** (una feature de Cargo, decidida al construir) y **qué permite la
instalación** (`[features]` en `ferris.toml`, decidido al arrancar). Lo segundo
solo puede apagar lo primero.

```toml
[features]
realtime = true
jobs = true
scheduler = true
email = true
files = true
print = true
report = true
search = true
webhooks = true
```

## Features de Cargo

| Feature | Añade |
|---|---|
| `api` | Base siempre presente: REST, autorización, sesiones públicas, `/health`. |
| `web` | Desk Leptos, SSR, `/static/*`, `/pkg/*`. |
| `realtime` | Socket.IO en `/socket.io`. |
| `jobs` | Cola de trabajos y rol `worker`. |
| `scheduler` | Cron; depende de `jobs`. |
| `email` | Hub de email y worker; depende de `jobs`. |
| `files` | Backend de ficheros, `/api/files` y descargas firmadas `/files/*`. |
| `print` | Rutas `/api/print/*`. |
| `report` | Rutas `/api/report*`. |
| `integrations` | OAuth/Google/LDAP/webhooks y su runtime. |
| `wasm` | Host wasmtime y rutas de plugins. |
| `full` | Alias que activa todas las anteriores. |

La build por defecto de `ferris-cli` y `ferris-server` es **todos los
verticales**: `api`, `web`, `realtime`, `jobs`, `scheduler`, `email`, `files`,
`print`, `report`, `integrations` y `wasm`.

### Construir

```bash
# Build por defecto
cargo build -p ferris-cli --release

# Build completa
cargo build -p ferris-cli --release --features full

# Servidor mínimo: API y Desk, sin verticales
cargo build -p ferris-cli --release \
  --no-default-features --features api,web
```

:::caution[El binario mínimo exige una configuración mínima]
`--no-default-features --features api,web` no basta. El `ferris.toml` generado
activa los verticales, y el arranque falla si pides algo que el binario no
tiene. Acompaña la build con:

```toml
[features]
realtime = false
jobs = false
scheduler = false
email = false
files = false
print = false
report = false
search = false
webhooks = false
```

No relajes la comprobación: el fallo al arrancar es la garantía de que el
proceso no se declara sano mientras sirve menos de lo configurado.
:::

## `[features]` en tiempo de ejecución

| Flag | `false` elimina |
|---|---|
| `realtime` | El rol realtime y Socket.IO. |
| `jobs` | El rol `worker` y el consumidor de la cola. |
| `scheduler` | El rol `scheduler` y el cron. |
| `email` | El hub y el worker de email. |
| `files` | `/files/*` y la superficie de ficheros. |
| `print` | `/api/print*`. |
| `report` | `/api/report*`. |
| `search` | `/api/search`. |
| `webhooks` | El despacho de webhooks de integraciones. |

Una ruta desactivada **no existe**: responde `404`. No es una respuesta vacía ni
un aviso en el cuerpo, porque un cliente no debe confundir "apagado" con "sin
resultados".

`search` y `webhooks` no tienen feature de Cargo equivalente: su código vive en
`ferris-api` y `ferris-integrations`, que siempre se enlazan. Son solo
interruptores de ejecución, y por eso no participan en la comprobación de
matriz.

## La regla de fallo al arrancar

`ferris serve`, `run`, `dev` y `doctor` comparan lo configurado con lo compilado
antes de abrir un socket o un pool:

- `[features] realtime = true` en un binario sin `realtime` → error de arranque.
- `[features] print = true` en un binario sin `print` → error de arranque, con la
  instrucción de recompilar.

El mensaje nombra todas las discrepancias a la vez y termina con
`Compiled features: ...`, para arreglar una configuración en un solo reinicio.

```text
the configuration asks for subsystems this binary was not compiled with:
[features] print = true.
Either rebuild ferris with `--features <name>`, or set the matching
`[features]` flag to false.
```

La fuente de verdad de "qué se compiló" es `ferris_server::host_features`,
construida con `cfg!` en el servidor. El CLI no lee sus propios `cfg!`: lee ese
conjunto, y la WIT lo publica en `platform::features()` para que un guest sepa
qué puede pedir.

## Roles y features no son lo mismo

`roles` elige qué arranca; `[features]` puede impedirlo. La combinación es un
AND: con `roles = ["all"]` y `realtime = false`, `scheduler = false`, el proceso
arranca `api`, `web` y `worker`. Los roles apagados se eliminan con un log que
dice cuál fue el motivo; si la lista queda vacía, el arranque falla.

Los roles son competencia del servidor. El CLI valida solo la matriz de features;
una segunda política en el CLI sería una capa que puede discrepar.

## Comprobar qué tienes

```bash
ferris info
ferris doctor
ferris config show
```

`info` imprime el conjunto compilado y las discrepancias; `doctor` tiene un check
**crítico** `Feature matrix`; `config show` deja el JSON por stdout y el conjunto
compilado por stderr, para no romper `| jq`. Ninguno imprime credenciales, claves
ni rutas de certificado: solo interruptores.

## Ejemplos

### Instalación completa

```bash
cargo build -p ferris-cli --release --features full
```

```toml
[features]
realtime = true
jobs = true
scheduler = true
email = true
files = true
print = true
report = true
```

### Solo API, sin Desk ni verticales

```bash
cargo build -p ferris-cli --release --no-default-features --features api
```

```toml
[server]
roles = ["api"]

[features]
realtime = false
jobs = false
scheduler = false
email = false
files = false
print = false
report = false
search = false
webhooks = false
```

`api` no tiene flag de runtime: es la base y no se puede apagar.
