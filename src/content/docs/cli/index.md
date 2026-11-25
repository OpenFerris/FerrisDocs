---
title: Referencia de comandos
description: El binario ferris, cómo invocarlo desde Docker, sus flags globales, códigos de salida y comandos.
---

`ferris` es la CLI del framework: un único binario, `ferris`, del paquete
`ferris-cli` (la misma versión que `[workspace.package]`), que arranca el
servidor, compila apps WASM, migra bases de datos y diagnostica el proyecto.
Todo lo que hay en esta sección describe el comportamiento del código de este
repositorio con el toolchain **Rust 1.98.1**.

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

Los comandos que operan sobre un proyecto leen la configuración del *bench*: el
loader sube desde el directorio actual hasta encontrar `config/ferris.toml`, así
que `ferris build` y `ferris dev` funcionan igual desde la raíz del bench o desde
`apps/<app>/`. El bench se crea con `ferris init` en una carpeta existente y los
comandos disponibles dependen de dónde estés: `ferris --help` dentro de un
sitio, de una app o de una carpeta sin inicializar muestra conjuntos distintos
(ver [ferris init y contexto](/cli/init-y-contexto/)). Un bench **no** incluye la
CLI: sus apps son componentes WIT/WASM que el servidor hospeda, y la CLI vive en
la instalación del framework, así que se invoca por ruta desde el directorio del
bench:

```bash
docker compose run --rm --workdir /workspace/bench \
  ferris /workspace/target/release/ferris doctor
```

Los comandos que abren un puerto (`dev`, `serve`) necesitan publicarlo:

```bash
docker compose run --rm --service-ports --workdir /workspace/bench \
  ferris /workspace/target/release/ferris dev --app billing
```

`--service-ports` aplica los mapeos declarados en `compose.yaml`; sin él, el
contenedor escucha en su red interna pero el navegador del host no lo alcanza.

`ferris new` y `ferris generate --what wit` copian `ferris-wasm/wit/ferris.wit`
desde la raíz del framework. Esa raíz se resuelve, por orden, con `FERRIS_HOME`,
el layout junto al ejecutable (`<prefix>/share/ferris`), `FERRIS_DATA_DIR`, el
layout del workspace en tiempo de compilación y, como último recurso, la copia
del WIT embebida en el binario, que se extrae a un directorio temporal.

## Comandos

| Comando | Qué hace |
|---|---|
| `ferris init` | Convierte una carpeta existente en bench (`config/`, `apps/`, `sites/`). |
| `ferris new` | Crea una app en `apps/<nombre>`; `--standalone` crea un proyecto de una sola app fuera de un bench. |
| `ferris site` | Crea, consulta, habilita, migra y borra sitios, e instala apps en ellos. |
| `ferris app` | Gestiona el catálogo global de apps. |
| `ferris dev` / `build` / `deploy` | Desarrollo, compilación y despliegue de una app. |
| `ferris serve` / `run` | Sirve el bench, un sitio (`--site`) o todos (`--all-sites`). |
| `ferris migrate` / `backup` / `restore` | Trabajan sobre la base y los ficheros del sitio donde estés, o del bench. |
| `ferris doctor` / `info` / `config` | Diagnóstico y configuración del bench. |

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
2. `--dir <DIR>`: sube desde `<DIR>` hasta encontrar `config/ferris.toml`.
3. Sin flags: igual, subiendo desde el directorio actual.

Sin `--config`, la raíz encontrada se convierte en el *bench root*: el directorio
que contiene `config/ferris.toml`, `apps/` y `sites/`. Por eso un comando
ejecutado dentro de `apps/billing/` sigue leyendo la configuración del bench y
escribe en el catálogo correcto. Con `--config`, el bench root es el padre del
directorio `config/` que contiene el fichero, o el directorio actual si el
fichero no vive en un `config/`.

Si el fichero no existe y no se pidió explícitamente, el comando arranca con los
valores por defecto y aplica variables de entorno; no es un error. Sobre el
fichero cargado se aplican siempre los *overrides* de entorno (`DATABASE_URL`,
`REDIS_URL`, `SERVER_HOST`, `SERVER_PORT`,
`FERRIS_REALTIME`, `FERRIS_UNLOCK_SOURCE`, `FERRIS_TLS_*`, `FERRIS_CA_*`, …).

Dos comprobaciones ocurren en cada arranque, para cualquier comando:

- la política de contraseñas y MFA se valida al cargar `[auth]`;
- una `[secrets] key` malformada es fatal, porque nada escrito en esa ejecución
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
| [`ferris new`](/cli/new/) | Crea un bench (`apps/` + `config/` + `sites/`) o una app `--standalone`. | Empezar un proyecto. |
| [`ferris dev`](/cli/dev/) | Servidor de desarrollo con API, Desk y realtime, más recarga del plugin. | Programar la app. |
| [`ferris serve`](/cli/serve-y-run/) | Servidor con roles por flags, `--site` o `--all-sites`. | Arrancar una instancia concreta. |
| [`ferris run`](/cli/serve-y-run/) | Servidor con los roles de `server.roles`. | Arrancar con la configuración del proyecto. |
| [`ferris build`](/cli/build-y-deploy/) | Compila el componente y escribe el paquete de catálogo en `apps/<app>/`. | Publicar el artefacto. |
| [`ferris deploy`](/cli/build-y-deploy/) | Docker, Kubernetes, binario o serverless (no implementado). | Desplegar el artefacto. |
| [`ferris app`](/cli/app/) | Instala, lista, habilita y retira apps del catálogo `apps/`. | Gestionar el catálogo global. |
| [`ferris migrate`](/cli/migrate/) | Migraciones de esquema y customizaciones de mundos de plugin. | Preparar o actualizar la base. |
| [`ferris generate`](/cli/generate/) | WIT, `schema.json`, tipos TypeScript y plantillas Typst. | Sincronizar artefactos derivados. |
| [`ferris tenant`](/cli/tenant/) | Alta, baja y migración de tenants. | Multi-tenant. |
| [`ferris shell`](/cli/shell-benchmark/) | REPL o passthrough de subcomandos. | Encadenar sin salir de la CLI. |
| [`ferris benchmark`](/cli/shell-benchmark/) | API, base de datos, realtime, jobs y print. | Medir antes de optimizar. |
| [`ferris info`](/cli/info-doctor-config/) | Versión, features compiladas, toolchain y proyecto. | Adjuntar a un issue. |
| [`ferris doctor`](/cli/info-doctor-config/) | Chequeos de salud, con la matriz de features como crítico. | Diagnosticar un arranque fallido. |
| [`ferris config`](/cli/info-doctor-config/) | `show`/`set`/`get`/`reset`/`edit` con las claves sensibles redactadas. | Ajustar `config/ferris.toml`. |
| [`ferris role-permissions`](/cli/role-permissions/) | Lee y escribe filas `DocPerm` en la base. | Permisos por rol y DocType. |

## Disponibilidad según las features de Cargo

`dev`, `build`, `deploy` y `app` solo existen si la CLI se compiló con la feature
`wasm` (está en el conjunto por defecto). Una compilación mínima
(`--no-default-features --features api`) no los ofrece, y `serve`/`run`/`doctor`
responden con la matriz de features que sí se compiló. Consulta
[features de compilación](/configuracion/features/) para el conjunto completo.

:::tip[Compilar el binario con otros gates]
```bash
docker compose run --rm ferris \
  cargo build -p ferris-cli --release --features full
```
El binario resultante sigue siendo `/workspace/target/release/ferris`; `full`
añade todos los subsistemas.
:::
