---
title: Referencia de comandos
description: El binario ferris 0.2.0, cómo invocarlo desde Docker, sus flags
  globales, códigos de salida y comandos.
slug: 0.2/cli
---

`ferris` es la CLI del framework: un único binario, `ferris`, del paquete
`ferris-cli` (versión **0.2.0**), que arranca el servidor, compila apps WASM,
migra bases de datos y diagnostica el proyecto. Todo lo que hay en esta sección
describe el comportamiento del código de este repositorio con el toolchain
**Rust 1.98.1**.

## Invocación canónica

El repositorio se desarrolla dentro del servicio `ferris` de `compose.yaml`, que
monta el checkout en `/workspace`. La forma de ejecutar la CLI sin instalar nada
en el host es:

```bash
docker compose run --rm ferris cargo run -p ferris-cli -- <comando>
```

Por ejemplo:

```bash
docker compose run --rm ferris cargo run -p ferris-cli -- --version
docker compose run --rm ferris cargo run -p ferris-cli -- info
```

Para repetir comandos sin recompilar, construye el binario una vez:

```bash
docker compose run --rm ferris cargo build -p ferris-cli --release
docker compose run --rm ferris /workspace/target/release/ferris --version
```

El paquete se llama `ferris-cli`, pero el `[[bin]]` se llama `ferris`; el
artefacto es `/workspace/target/release/ferris`.

## Proyecto y directorio de trabajo

Los comandos que operan sobre un proyecto (`migrate`, `doctor`, `dev`, `serve`)
leen `config/ferris.toml` del directorio actual. Un proyecto creado con
`ferris new` es un componente WASM independiente y no incluye la CLI, así que
hay que entrar en su directorio y llamar al binario por ruta:

```bash
docker compose run --rm --workdir /workspace/my-app \
  ferris /workspace/target/release/ferris doctor
```

Los comandos que abren un puerto (`dev`, `serve`) necesitan publicarlo:

```bash
docker compose run --rm --service-ports --workdir /workspace/my-app \
  ferris /workspace/target/release/ferris dev
```

`--service-ports` aplica los mapeos declarados en `compose.yaml`; sin él, el
contenedor escucha en su red interna pero el navegador del host no lo alcanza.

Un proyecto creado con `ferris new` **no** incluye la CLI: genera un componente
WIT/WASM (`cdylib` para `wasm32-wasip2`) que el servidor hospeda. La CLI vive en
la instalación del framework.

`ferris new` y `ferris generate --what wit` copian `ferris-wasm/wit/ferris.wit`
desde la raíz del framework. Esa raíz se resuelve, por orden, con `FERRIS_HOME`,
el layout junto al ejecutable (`<prefix>/share/ferris`), `FERRIS_DATA_DIR`, el
layout del workspace en tiempo de compilación y, como último recurso, la copia
del WIT embebida en el binario, que se extrae a un directorio temporal.

## Flags globales

| Flag | Efecto |
|---|---|
| `-v`, `--verbose` | Sube el log de `ferris` a `debug` y, en `ferris dev`, deja de pasar `--quiet` a `cargo`. |
| `-c`, `--config <FILE>` | Usa ese fichero de configuración. Debe existir: si no, el comando falla con `ConfigError::NotFound`. |
| `-d`, `--dir <DIR>` | Directorio de trabajo del proyecto. Debe ser un directorio; si no lo es, el proceso sale con código 1. |

Los tres son `global = true`, así que valen antes o después del subcomando:

```bash
ferris --dir /srv/app doctor
ferris doctor --dir /srv/app
```

`--dir` no es lo mismo que el `--into` de `ferris new`: `--dir` mueve el proceso
al proyecto y hace que todas las rutas relativas (`Cargo.toml`, `config/`,
`plugins/`, `target/`) se resuelvan ahí. `main` hace `set_current_dir` una sola
vez, tras cargar la configuración.

## Cómo se descubre la configuración

`CliConfig::load` resuelve el fichero así:

1. `--config <FILE>`: se usa tal cual; si no existe, es un error.
2. `--dir <DIR>`: `<DIR>/config/ferris.toml`.
3. Sin flags: `<cwd>/config/ferris.toml`.

Si el fichero no existe y no se pidió explícitamente, el comando arranca con los
valores por defecto y aplica variables de entorno; no es un error. Sobre el
fichero cargado se aplican siempre los *overrides* de entorno (`DATABASE_URL`,
`REDIS_URL`, `FERRIS_JWT_SECRET`, `SERVER_HOST`, `SERVER_PORT`,
`FERRIS_REALTIME`, `FERRIS_UNLOCK_SOURCE`, `FERRIS_TLS_*`, `FERRIS_CA_*`, …).

Dos comprobaciones ocurren en cada arranque, para cualquier comando:

* un `[auth] jwt_secret` igual a `change-me-in-production` es un error duro;
* una `[secrets] key` malformada es fatal, porque nada escrito en esa ejecución
  podría descifrarse después.

## Salida, logging y códigos de salida

El filtro de log se construye como `ferris=<nivel>,warn`: `info` por defecto,
`debug` con `--verbose`, y `warn` para el resto de crates. `RUST_LOG` **no** se
lee; el nivel se cambia con `--verbose`. En `dev --hot-reload front|both` el
proceso cede el control a cargo-leptos, que instala su propio logger.

| Código | Cuándo |
|---|---|
| `0` | El comando terminó bien. |
| `1` | El comando devolvió un error; se imprime `Command failed: …` y se sale. |
| `2` | Error de argumentos de clap (flag desconocido, falta un valor). Sin argumentos se imprime la ayuda. |

`ferris shell <comando…>` es la excepción: si el comando interno falla, la CLI
devuelve su propio error con código 1, no el código del hijo.

## Comandos

| Comando | Qué hace | Cuándo usarlo |
|---|---|---|
| [`ferris new`](/0.2/cli/new/) | Crea un proyecto WIT/WASM con config, toolchain y WIT. | Empezar una app. |
| [`ferris dev`](/0.2/cli/dev/) | Servidor de desarrollo con API, Desk y realtime, más recarga del plugin. | Programar la app. |
| [`ferris serve`](/0.2/cli/serve-y-run/) | Servidor con roles elegidos por flags. | Arrancar una instancia concreta. |
| [`ferris run`](/0.2/cli/serve-y-run/) | Servidor con los roles de `server.roles`. | Arrancar con la configuración del proyecto. |
| [`ferris build`](/0.2/cli/build-y-deploy/) | Compila el componente y lo deja en `plugins/<app>.wasm`. | Publicar el artefacto. |
| [`ferris deploy`](/0.2/cli/build-y-deploy/) | Docker, Kubernetes, binario o serverless (no implementado). | Desplegar el artefacto. |
| [`ferris migrate`](/0.2/cli/migrate/) | Migraciones de esquema y customizaciones de mundos de plugin. | Preparar o actualizar la base. |
| [`ferris generate`](/0.2/cli/generate/) | WIT, `schema.json`, tipos TypeScript y plantillas Typst. | Sincronizar artefactos derivados. |
| [`ferris tenant`](/0.2/cli/tenant/) | Alta, baja y migración de tenants. | Multi-tenant. |
| [`ferris shell`](/0.2/cli/shell-benchmark/) | REPL o passthrough de subcomandos. | Encadenar sin salir de la CLI. |
| [`ferris benchmark`](/0.2/cli/shell-benchmark/) | API, base de datos, realtime, jobs y print. | Medir antes de optimizar. |
| [`ferris info`](/0.2/cli/info-doctor-config/) | Versión, features compiladas, toolchain y proyecto. | Adjuntar a un issue. |
| [`ferris doctor`](/0.2/cli/info-doctor-config/) | Chequeos de salud, con la matriz de features como crítico. | Diagnosticar un arranque fallido. |
| [`ferris config`](/0.2/cli/info-doctor-config/) | `show`/`set`/`get`/`reset`/`edit` con las claves sensibles redactadas. | Ajustar `config/ferris.toml`. |
| [`ferris role-permissions`](/0.2/cli/role-permissions/) | Lee y escribe filas `DocPerm` en la base. | Permisos por rol y DocType. |

## Disponibilidad según las features de Cargo

`dev`, `build` y `deploy` solo existen si la CLI se compiló con la feature
`wasm` (está en el conjunto por defecto). Una compilación mínima
(`--no-default-features --features api`) no los ofrece, y `serve`/`run`/`doctor`
responden con la matriz de features que sí se compiló. Consulta
[features de compilación](/0.2/configuracion/features/) para el conjunto completo.

:::tip[Compilar el binario con otros gates]
```bash
docker compose run --rm ferris \
  cargo build -p ferris-cli --release --features full
```

El binario resultante sigue siendo `/workspace/target/release/ferris`; `full`
añade todos los subsistemas, incluido el cliente MQTT.
:::
