---
title: Entorno de desarrollo
description: Cómo está construida la imagen Docker, qué monta Compose, el devcontainer y cómo diagnosticar o limpiar el entorno.
---

El entorno de Ferris es una imagen Docker construida desde el `Dockerfile` de la
raíz y orquestada por `compose.yaml`. Esta página explica qué hay dentro, por qué
está separado en etapas y qué hacer cuando algo no encaja. Para el uso diario,
basta con [instalación](/getting-started/instalacion/) y
[contribuir](/contribuir/).

## La imagen, etapa por etapa

```text
node:24-bookworm-slim  ──►  solo binarios de Node
                                    │
rust:1.98.1-bookworm   ──►  base + sistema + toolchain + Node
                                    │
                              usuario no-root + /workspace
```

1. **Etapa `node`.** Parte de `node:24-bookworm-slim` únicamente para copiar
   `/usr/local/bin/node` y `/usr/local/lib/node_modules` a la imagen final. Así
   el Desk, el sitio de documentación y `cargo-leptos` usan Node 24 en lugar del
   paquete, más antiguo, de Debian.
2. **Etapa final.** Parte de `rust:1.98.1-bookworm`, que ya trae `rustup` y el
   toolchain **1.98.1**. Añade `build-essential`, `ca-certificates`, `curl`,
   `git`, `libsqlite3-dev`, `libssl-dev`, `pkg-config` y `sqlite3`.
3. **Targets.** `rustup target add wasm32-unknown-unknown wasm32-wasip2`: el
   primero es el bundle de hidratación del Desk, el segundo el componente de app.
4. **Herramientas.** `cargo install wasm-bindgen-cli --version 0.2.128 --locked`,
   `cargo install cargo-leptos --locked` y `cargo install wasm-tools --locked`.
   Se instalan en `/usr/local/cargo/bin`, fuera del workspace, y quedan
   congeladas en la capa de la imagen.

`CARGO_HOME` y `RUSTUP_HOME` apuntan a `/usr/local/cargo` y `/usr/local/rustup`,
y el `PATH` antepone esos binarios. Por eso `cargo`, `rustc`, `wasm-bindgen`,
`cargo-leptos` y `wasm-tools` resuelven a las versiones de la imagen y no a las
del sistema base.

## Usuario, montaje y propietarios

La imagen crea un usuario sin privilegios llamado `ferris` y trabaja en
`/workspace`:

```dockerfile
ARG USER_NAME=ferris
ARG USER_ID=1000
ARG GROUP_ID=1000
```

`USER_ID` y `GROUP_ID` existen para que los ficheros creados dentro del
contenedor pertenezcan a tu usuario del host en Linux. Compose los pasa como
argumentos de build desde el entorno:

```yaml
build:
  args:
    USER_ID: ${USER_ID:-1000}
    GROUP_ID: ${GROUP_ID:-1000}
```

Si tu UID no es `1000`, escribe un `.env` local (ignorado por git) y reconstruye:

```bash
printf 'USER_ID=%s\nGROUP_ID=%s\n' "$(id -u)" "$(id -g)" > .env
docker compose build
```

El repositorio **no se copia** en la imagen: Compose lo monta como bind mount.

```yaml
volumes:
  - .:/workspace
  # FerrisFramework references Core by path; the sibling is visible here.
  - ../FerrisCore:/FerrisCore
```

Eso hace que los cambios del host se vean al instante y que `target/` viva en tu
disco, no dentro de la imagen. El segundo montaje es obligatorio: las crates de
Framework apuntan a `../../FerrisCore/ferris-*`, que desde `ferris-server/` (o
cualquier crate hermana) resuelve a `/FerrisCore`. `FerrisCore` tiene su propio
`Dockerfile` y `compose.yaml` para trabajar solo en la base.

El `CMD` de la imagen es `bash`; Compose lo sobrescribe cuando le pasas un
comando (`docker compose run --rm ferris cargo check`).

## Devcontainer

`.devcontainer/devcontainer.json` reutiliza la misma imagen:

| Clave | Valor |
|---|---|
| `build.dockerfile` | `../Dockerfile` con contexto en la raíz |
| `workspaceFolder` | `/workspace` |
| `workspaceMount` | bind del checkout local a `/workspace` |
| `remoteUser` | `ferris` |
| `postCreateCommand` | imprime `cargo`, `rustc` y `node --version` |
| `forwardPorts` | `8000`, `4321`, `5432`, `6379` |

Añade las extensiones de Rust, TOML, Tailwind y Astro, y configura
`rust-analyzer.check.command = "check"`. El language server corre **dentro** del
contenedor, así que usa el toolchain de la imagen y no toca el del host.

`docker compose build` y el devcontainer construyen la misma imagen: un cambio
en el `Dockerfile` afecta a ambos y hay que reconstruir.

## Servicios de Compose

| Servicio | Imagen | Puertos | Notas |
|---|---|---|---|
| `ferris` | `ferris-dev` (build local) | `8000`, `4321` | Shell de desarrollo; `FERRIS_JWT_SECRET` de desarrollo y `RUST_BACKTRACE=1` |
| `postgres` | `postgres:17-alpine` | `5432` | Usuario, contraseña y base `ferris`; volumen `postgres-data` |
| `redis` | `redis:7-alpine` | `6379` | Sin persistencia (`--save "" --appendonly no`) |

`postgres` y `redis` declaran `healthcheck`, así que `docker compose ps` muestra
`healthy` cuando aceptan conexiones. `docker compose up -d postgres redis` los
arranca sin levantar el servicio de desarrollo.

Los puertos del servicio `ferris` solo se publican al usar `docker compose up` o
`docker compose run --service-ports`; un `run` normal no los mapea.

## Diagnóstico

Cuando algo no arranca, estas órdenes acotan el problema sin tocar el código:

```bash
# Configuración resuelta (variables incluidas)
docker compose config

# Estado e imágenes
docker compose ps
docker compose images

# Versiones realmente disponibles dentro del contenedor
docker compose run --rm ferris bash -lc 'id && rustc -V && cargo -V && node -v'

# Logs de un servicio
docker compose logs --tail=100 postgres
```

Si sospechas de una capa corrupta o de una herramienta mal instalada,
reconstruye sin caché:

```bash
docker compose build --no-cache
```

Es lento (recompila `wasm-bindgen-cli`, `cargo-leptos` y `wasm-tools`); úsalo
como último recurso. Un `docker compose build` normal basta cuando cambia el
`Dockerfile` o los argumentos de UID/GID.

:::tip[Errores de permisos]
Si aparecen ficheros de otro propietario, comprueba `id` dentro del contenedor y
los argumentos de build. Corrige el `.env`, reconstruye y ajusta la propiedad de
los ficheros afectados desde el host. No ejecutes comandos como `root` para
"arreglarlo": eso crea más ficheros con el propietario equivocado.
:::

## macOS y Windows

Docker Desktop ejecuta el motor en una máquina virtual, lo que cambia dos cosas:

- **Rendimiento del bind mount.** `target/` contiene decenas de miles de
  ficheros; en un montaje compartido, los enlaces y las lecturas son más lentos
  que en Linux. Mantén el checkout en el sistema de ficheros nativo (no en una
  carpeta sincronizada por la nube) y no muevas `target/` fuera del proyecto.
- **Recursos.** Asigna al motor Docker suficiente memoria y CPU; la suite de
  tests y los enlaces de Rust son intensivos. Si el motor mata procesos, sube el
  límite antes de culpar al código.

La propagación de eventos del sistema de ficheros puede no ser inmediata. Si
`ferris dev` no recarga tras un cambio, guarda el fichero de nuevo o reinicia el
proceso; no es un fallo del watcher.

En Windows, mantén los finales de línea LF en los ficheros que se ejecutan dentro
del contenedor (`git config core.autocrlf input`). Un script con CRLF falla con
un error de intérprete que no tiene nada que ver con Ferris.

## Limpiar sin romper la caché

**Nunca ejecutes `cargo clean`**: borra todo el grafo compilado y convierte el
siguiente `cargo check` en una reconstrucción completa. Si necesitas espacio,
elimina un solo perfil:

```bash
# Solo los artefactos de un target concreto
docker compose run --rm ferris rm -rf target/wasm32-unknown-unknown

# O un perfil completo
docker compose run --rm ferris rm -rf target/debug
```

Para el entorno:

```bash
docker compose down          # para y borra los contenedores; conserva postgres-data
docker compose down -v       # además borra el volumen de PostgreSQL (pierdes datos)
docker image rm ferris-dev   # fuerza reconstruir la imagen en el próximo build
docker system df             # cuánto ocupa Docker
```

`docker builder prune` libera caché de build, pero obliga a reconstruir capas
caras. Úsalo con la misma cautela que `cargo clean`.

## Siguiente paso

Con el entorno claro, revisa los gates y el flujo de PR en
[contribuir](/contribuir/) y las reglas de la suite en
[pruebas](/contribuir/pruebas/).
