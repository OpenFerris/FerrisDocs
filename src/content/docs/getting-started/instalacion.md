---
title: Instalación
description: Requisitos de la versión actual de Ferris y cómo preparar el entorno de desarrollo con Docker y Docker Compose.
---

Ferris no tiene instalador ni script de bootstrap: se compila desde los dos
repositorios con Cargo y el binario resultante se llama `ferris`. El entorno
canónico es un contenedor **Docker** que ya trae Rust, Node, los targets de
WebAssembly y las herramientas de componentes, de modo que el mismo checkout
compila igual en Linux, macOS y Windows.

## Requisitos

| Requisito | Versión | Para qué |
|---|---|---|
| Docker Engine | 24 o superior | Construir y ejecutar la imagen de desarrollo |
| Docker Compose | v2 (`docker compose`) | Orquestar `ferris`, PostgreSQL y Redis |
| Git | 2.x | Clonar el repositorio |
| Node.js | 22.23.4 o superior | **Opcional**: solo para el sitio de docs fuera de Docker |
| Disco | varios GB libres | Imagen, dependencias y `target/` |

No hace falta instalar Rust ni Node en el host: el `Dockerfile` los deja dentro
de la imagen. Para el primer arranque tampoco hace falta una base de datos
externa, porque el scaffold de `ferris new` usa SQLite.

## Qué incluye la imagen

La imagen `ferris-dev` se construye con dos etapas: una base
`rust:1.98.1-bookworm` y una etapa `node:24-bookworm-slim` de la que solo se
copian los binarios de Node. Sobre esa base instala:

| Herramienta | Versión / valor | Para qué |
|---|---|---|
| `rustc` y `cargo` | **1.98.1** (pin del proyecto) | Compilar el workspace y la CLI |
| Target | `wasm32-unknown-unknown` | Bundle de hidratación del Desk |
| Target | `wasm32-wasip2` | Componente de app que hospeda `ferris dev` |
| Node y npm | Node 24 | Dependencias del Desk y del sitio de docs |
| `wasm-bindgen` | **0.2.128** | Generar el glue JS del bundle de hidratación |
| `cargo-leptos` | última estable | `ferris dev --hot-reload front\|both` |
| `wasm-tools` | última estable | Componentizar el módulo wasm de la app |
| Sistema | `build-essential`, `pkg-config`, `libsqlite3-dev`, `libssl-dev`, `sqlite3` | Enlazar el workspace |

El `libssl-dev` es solo para las herramientas de desarrollo; la aplicación usa
`rustls`.

## Clonar y construir

Ferris se reparte en dos repositorios de Rust que deben estar **hermanos**:
`FerrisFramework` (Desk, verticales, servidor y CLI) referencia a `FerrisCore`
(base mínima) con rutas `../../FerrisCore/ferris-*`.

```bash
mkdir ferris && cd ferris
git clone https://github.com/OpenFerris/FerrisFramework.git
git clone https://github.com/OpenFerris/FerrisCore.git
cd FerrisFramework
docker compose build
```

La documentación vive en un tercer repositorio,
[`FerrisDocs`](https://github.com/OpenFerris/FerrisDocs), y se construye con
Node sin depender de ninguno de los dos checkouts de Rust.

`docker compose build` construye la imagen `ferris-dev` a partir del
`Dockerfile`. La primera vez tarda varios minutos porque compila e instala
`wasm-bindgen-cli`, `cargo-leptos` y `wasm-tools`; las siguientes reutilizan las
capas.

El servicio `ferris` monta `FerrisFramework` en `/workspace` y `FerrisCore` en
`/FerrisCore`, así que los cambios del host se ven al instante dentro del
contenedor y las rutas `../../FerrisCore/...` resuelven.

## Abrir una shell

```bash
docker compose run --rm ferris bash
```

`--rm` borra el contenedor al salir; el repositorio y `target/` siguen en el
host porque están montados. Para un comando suelto no hace falta la shell:

```bash
docker compose run --rm ferris cargo check -p ferris-core
docker compose run --rm ferris cargo run -p ferris-cli -- --version
```

## Sanity check

```bash
docker compose run --rm ferris bash -lc \
  'rustc -V && cargo -V && node -v'
```

Debe imprimir `1.98.1` para `rustc` y `cargo`, y una versión `v24.x` de Node. Si
`cargo -V` imprime otra cosa, estás usando una imagen vieja: reconstruye con
`docker compose build`.

Comprueba también los targets y las herramientas:

```bash
docker compose run --rm ferris rustup target list --installed
docker compose run --rm ferris bash -lc \
  'wasm-bindgen --version && cargo leptos --version && wasm-tools --version'
```

La primera orden debe listar `wasm32-unknown-unknown` y `wasm32-wasip2`. La
segunda debe responder con `wasm-bindgen 0.2.128` y las versiones instaladas de
`cargo-leptos` y `wasm-tools`.

:::tip[Un alias para no repetir]
```bash
dc() { docker compose run --rm ferris "$@"; }
dc cargo check -p ferris-document
```
Los comandos que abren un puerto necesitan además publicarlo; ver
[inicio rápido](/getting-started/inicio-rapido/).
:::

## PostgreSQL y Redis

SQLite basta para el camino mínimo. Si vas a usar PostgreSQL o Redis, los
servicios ya están declarados en `compose.yaml`:

```bash
docker compose up -d postgres redis
docker compose ps
```

| Servicio | Credenciales de desarrollo | Puerto en el host |
|---|---|---|
| `postgres` | usuario `ferris`, contraseña `ferris`, base `ferris` | `5432` |
| `redis` | sin autenticación (solo desarrollo) | `6379` |

Desde el contenedor `ferris`, el host de conexión es el nombre del servicio:
`postgres://ferris:ferris@postgres:5432/ferris` y `redis://redis:6379`. Desde el
host es `localhost`. Ambos servicios tienen `healthcheck`, así que
`docker compose ps` muestra `healthy` cuando están listos.

Para apuntar la aplicación a PostgreSQL sin editar `config/ferris.toml`, exporta
`DATABASE_URL` en el servicio o pásala al comando que arranca el proyecto. Por
ejemplo, cuando tengas el `my-app` de [inicio rápido](/getting-started/inicio-rapido/):

```bash
docker compose run --rm --workdir /workspace/my-app \
  -e DATABASE_URL=postgres://ferris:ferris@postgres:5432/ferris \
  ferris /workspace/target/release/ferris migrate
```

Puedes comprobar la conectividad sin proyecto:

```bash
docker compose exec postgres psql -U ferris -d ferris -c 'select 1'
```

## Volúmenes y permisos

El repositorio se monta como *bind mount* (`.:/workspace`), no se copia en la
imagen. Eso mantiene tus ficheros y tu `target/` en el host, pero significa que
el UID del usuario del contenedor debe coincidir con el tuyo en Linux, o los
ficheros aparecerán con otro propietario.

Los argumentos de build `USER_ID` y `GROUP_ID` existen para eso. Compose los lee
del entorno (o de un `.env` local, que está en `.gitignore`):

```bash
printf 'USER_ID=%s\nGROUP_ID=%s\n' "$(id -u)" "$(id -g)" > .env
docker compose build
```

En Docker Desktop (macOS y Windows) la traducción de propietarios la hace el
propio Docker; los valores por defecto `1000` suelen ser correctos.

:::caution[No mezcles usuarios]
Si ejecutas un comando como `root` dentro del contenedor, `target/` y el
repositorio quedan con ficheros que tu usuario del host no puede sobrescribir.
Usa siempre el usuario por defecto de la imagen (`ferris`).
:::

## Sin Docker

Docker es la vía soportada y la única que garantiza las versiones exactas. Si no
puedes usarlo, necesitas reproducir la imagen a mano:

```bash
rustup toolchain install 1.98.1 --profile minimal \
  --component rustfmt clippy rust-analyzer \
  --target wasm32-unknown-unknown wasm32-wasip2
cargo install wasm-bindgen-cli --version 0.2.128 --locked
cargo install cargo-leptos --locked
cargo install wasm-tools --locked
```

Además hacen falta Node 22.23.4 o superior, `build-essential`, `pkg-config`,
`libsqlite3-dev` y `libssl-dev`. Esta vía no está cubierta por la documentación
ni por la CI: si algo falla por una versión distinta, el primer paso es volver a
Docker.

## Siguiente paso

Con la imagen construida y el sanity check en verde, crea un proyecto y
arráncalo:

→ [Inicio rápido](/getting-started/inicio-rapido/)
