---
title: Variables de entorno
description: Variables que lee Ferris de verdad, qué hacen, sus defaults y cómo se evita filtrar credenciales.
---

La configuración vive en `config/ferris.toml` (o `ferris.yaml`), pero el proceso
lee variables de entorno para dos cosas: **inyección de contenedor** (secretos,
rutas, puertos) y **overrides** de un despliegue.

Precedencia, de menor a mayor:

```text
ferris.toml  →  ferris.yaml  →  entorno FERRIS_* (con __ como separador)
```

Un fichero ausente no es un error; un directorio de configuración ausente sí
(`ConfigError::NotFound`).

El **CLI** usa un loader propio (`CliConfig`) que lee `config/ferris.toml` y un
subconjunto explícito de variables. El **servidor** usa `ferris_core::Config`,
que sí aplica el overlay genérico `FERRIS_*` con `__` como separador. Las dos
tablas de abajo marcan cuál es cuál.

## Selección de configuración

| Variable | Efecto | Default |
|---|---|---|
| `FERRIS_CONFIG_DIR` | Directorio de configuración a cargar | `dirs::config_dir()/ferris` |
| `FERRIS_PROJECT_DIR` | Raíz del proyecto; de ella cuelgan `apps/`, `plugins/` y `sites/` | directorio actual |
| `FERRIS_PLUGINS_DIR` | Fuerza el directorio de plugins/worlds | `<project>/plugins` |
| `FERRIS_APPS_DIR` | Catálogo global de apps | `<project>/apps` |
| `FERRIS_SITES_DIR` | Raíz de los sitios | `<project>/sites` |
| `FERRIS_TENANTS_DIR` | Raíz de los ficheros de tenant | `<config>/ferris/tenants` |
| `FERRIS_HOME` | Layout del framework del que `ferris new` copia el WIT | autodetectado junto al binario |
| `FERRIS_DATA_DIR` | Directorio de datos con el WIT embebido | — |

`FERRIS_HOME` se valida: si apunta a algo que no es un directorio, el comando
falla en vez de buscar en otro sitio.

## Acceso genérico a la configuración

El servidor (`ferris_core::Config`) permite sobrescribir cualquier clave con
`FERRIS_` y `__` como separador de nivel:

```bash
export FERRIS_DATABASE__TYPE=postgres
export FERRIS_DATABASE__HOST=db.internal
export FERRIS_SERVER__PORT=9000
export FERRIS_AUTH__MAX_LOGIN_ATTEMPTS=10
```

Esto lo aplica figment sobre el árbol fusionado. No hay lista cerrada: la clave
existe si existe en el modelo de configuración.

## Base de datos y Redis

| Variable | Efecto | Default |
|---|---|---|
| `DATABASE_URL` | URL completa; se aplica a la config estructurada si el esquema es soportado | — |
| `REDIS_URL` | URL de Redis | `redis://localhost:6379` |

Si `DATABASE_URL` no se puede mapear (esquema desconocido o URL mal formada), se
registra un warning y el valor queda disponible en `custom.database_url`; **no**
se aplica a medias.

## Servidor

| Variable | Efecto | Default |
|---|---|---|
| `SERVER_HOST` | Host de escucha | `0.0.0.0` |
| `SERVER_PORT` | Puerto (u16; un valor inválido se ignora con warning) | `8000` |
| `FERRIS_BODY_LIMIT_MB` | Tamaño máximo de cuerpo en MB (`0` se rechaza) | `50` |
| `FERRIS_HTTP_LOG` | `0`/`false` apaga el log de peticiones | activado |

## Impresión

| Variable | Efecto | Default |
|---|---|---|
| `FERRIS_PRINT_TEMPLATE_DIR` | Raíz de la que cuelgan las carpetas `template_dir` de los `Print Format`; habilita `{% include %}`, `{% extends %}` y los `read()` de Typst | `templates/print` si existe; si no, solo plantillas inline |
| `FERRIS_PRINT_FONT_DIR` | Directorio con fuentes extra para Typst | solo las incluidas |

El servidor valida la raíz al arrancar (`ferris-print` falla en `boot` si no es
legible) y cada formato resuelve su subcarpeta relativa sin permitir `..`, rutas
absolutas ni symlinks fuera de la raíz.

## TLS, mTLS y PKI

| Variable | Efecto |
|---|---|
| `FERRIS_TLS_CERT` | Ruta del certificado del servidor |
| `FERRIS_TLS_KEY` | Ruta de la clave del servidor |
| `FERRIS_MTLS_CLIENT_CA` | CA para validar certificados de cliente |
| `FERRIS_MTLS_REQUIRE` | `true` exige certificado de cliente |
| `FERRIS_TLS_MIN_VERSION` | Versión mínima de TLS |
| `FERRIS_CA_CERT` / `FERRIS_CA_KEY` | CA interna (ambas necesarias) |
| `FERRIS_CA_TTL_SECONDS` | TTL por defecto de los certificados emitidos |

Si defines solo una de las dos rutas de un par, el arranque **falla** al no poder
leer el fichero; no se desactiva TLS en silencio.

## Secretos y autenticación

| Variable | Efecto | Notas |
|---|---|---|
| `FERRIS_JWT_SECRET` (o `JWT_SECRET`) | Secreto HS256 | Mínimo 32 caracteres; `change-me-in-production` se rechaza |
| `FERRIS_SECRET_KEY` (o `FERRIS_SECRETS__KEY`) | Clave de cifrado de campos `Secret` (AES-256-GCM) | Ambas grafías funcionan |
| `FERRIS_SECRET_PREVIOUS_KEYS` | Claves anteriores, separadas por comas | Permiten descifrar valores cifrados con ellas |
| `FERRIS_ADMIN_PASSWORD` | Contraseña del admin para `ferris tenant create` | Evita pasarla por argv |
| `FERRIS_UNLOCK_SOURCE` | `true` desbloquea el modo fuente del CLI | Booleano; un valor inválido se ignora |

:::danger[El secreto JWT no tiene default]
Sin `FERRIS_JWT_SECRET`/`JWT_SECRET` no hay firma utilizable. `serve`/`run`
fallan al arrancar si falta; `ferris dev` genera un secreto efímero en memoria
para el front. El placeholder `change-me-in-production` se rechaza
explícitamente.

El `compose.yaml` de desarrollo inyecta un valor conocido
(`dev-only-change-me-…`) para que los comandos del contenedor funcionen sin
configuración. Ese valor es público: expórtalo con uno propio antes de usar
`serve` en cualquier host alcanzable. La comprobación de arranque actual rechaza
solo `change-me-in-production`; el resto de valores, incluido el del compose, se
aceptan.
:::

## Interruptores de features

Se aplican como booleanos sobre `[features]`. Solo **apagan o permiten** lo que
el binario compiló:

| Variable | Feature |
|---|---|
| `FERRIS_REALTIME` | `realtime` |
| `FERRIS_JOBS` | `jobs` |
| `FERRIS_SCHEDULER` | `scheduler` |
| `FERRIS_EMAIL` | `email` |
| `FERRIS_FILES` | `files` |
| `FERRIS_PRINT` | `print` |
| `FERRIS_REPORT` | `report` |
| `FERRIS_SEARCH` | `search` |
| `FERRIS_WEBHOOKS` | `webhooks` |

Activar por entorno un gate cuyo subsistema no se compiló es un error de
arranque, igual que en el fichero. Credenciales de servicios externos no se
configuran por entorno: pertenecen al fichero.

## Host de plugins y HTTP saliente

| Variable | Efecto | Default |
|---|---|---|
| `FERRIS_HTTP_ALLOWED_HOSTS` | Lista de hosts permitidos para HTTP de un guest | `localhost,127.0.0.1` |
| `FERRIS_HTTP_MAX_BODY` | Tamaño máximo de cuerpo de salida | límite del host |
| `FERRIS_HTTP_TIMEOUT_MS` | Timeout de la petición saliente | límite del host |
| `FERRIS_PLUGIN_STREAM_AUTH` | `required` exige sesión o certificado en streams de plugin | `optional` |
| `FERRIS_APP_ALLOWED_PROGRAMS` | Lista separada por `:` de binarios del host que una app puede ejecutar con `platform::process`; sin ella, solo se ejecutan programas dentro de su `world` | vacío (solo `world`) |

## Otros

| Variable | Efecto |
|---|---|
| `FERRIS_BENCH_URL` | Base URL que usa `ferris benchmark` |
| `EDITOR` | Editor de `ferris config edit` (`vim` por defecto) |

## Redacción

Los comandos que imprimen configuración (`ferris config show`, `ferris doctor`,
`ferris info`) muestran **interruptores**, no valores sensibles: ni
contraseñas, ni credenciales embebidas en una URL, ni rutas de certificados. Una
URL con `user:password@` se reporta con el userinfo enmascarado.

:::caution[No pongas secretos en argv]
`ferris tenant create --admin-password …` funciona, pero avisa: el valor queda
visible en `ps` para cualquier usuario de la máquina. Usa
`FERRIS_ADMIN_PASSWORD` o el prompt interactivo.
:::

## Comprobar qué se cargó

```bash
# Config efectiva (secretos redactados)
ferris config show

# Una clave concreta
ferris config get database.type
```

El conjunto de features compiladas se imprime en **stderr** en `config show`,
para que `stdout` siga siendo JSON parseable.
