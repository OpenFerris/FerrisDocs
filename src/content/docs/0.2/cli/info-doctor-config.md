---
title: ferris info, doctor y config
description: Qué imprime info, qué comprueba doctor —con la matriz de features
  como chequeo crítico— y cómo show, set, get, reset y edit tratan el fichero de
  configuración y sus secretos.
slug: 0.2/cli/info-doctor-config
---

Tres comandos de diagnóstico y configuración. Ninguno de ellos necesita que el
servidor esté corriendo.

## `ferris info`

Responde siempre, aunque falte una herramienta: si `rustc` no está en el `PATH`
lo dice, no se cae. Imprime cinco secciones:

| Sección | Contenido |
|---|---|
| `Version` | Nombre y versión del paquete de la CLI. |
| `Features` | Conjunto **compilado**, resumen de `[features]`, estado de `[mqtt]`, notas de contradicción y cada *mismatch*. |
| `Toolchain` | Salida de `rustc --version` y `cargo --version`, o el motivo por el que no se pudo. |
| `Project` | `name`, `version` y `description` leídos de `Cargo.toml`; si no hay proyecto, lo dice. |
| `Dependencies` | Primeras 20 líneas de `cargo tree --depth 1`. |

Solo imprime interruptores: ni URLs de broker, ni credenciales, ni rutas TLS. Es
seguro pegarlo en un issue.

```text
=== Features ===
  compiled: api, email, files, integrations, jobs, print, realtime, report, scheduler, wasm, web
  configured: realtime=on jobs=on scheduler=on email=on files=on print=on report=on search=on webhooks=on mqtt=off
  [mqtt] not requested
```

Un `mismatch` aquí es la misma condición que impide arrancar a `serve`: la
configuración pide un subsistema que este binario no compiló.

## `ferris doctor`

Ejecuta once comprobaciones, en este orden, y devuelve un informe con `✓ PASS` /
`✗ FAIL`, la marca `[CRITICAL]` y un resumen.

| Chequeo | Crítico | Qué mira |
|---|---|---|
| `Rust toolchain` | sí | `rustc --version` funciona. |
| `Cargo` | sí | `cargo --version` funciona. |
| `Cargo.toml` | sí | Existe en el directorio actual. |
| `Project structure` | sí | Existen `src/` y `config/`; avisa si falta `wit/ferris.wit`. |
| `Config files` | sí | Existe `config/ferris.toml`. |
| `Feature matrix` | sí | Lo compilado frente a lo que pide la configuración. |
| `Database configuration` | según el caso | SQLite: pasa siempre y es crítico solo si el fichero ya existe. Servidores: crítico si conecta; si no conecta, falla sin ser crítico. |
| `Redis` | no | Se salta como “not required: realtime is disabled”. Con realtime activo, hace `PING`. |
| `Secret fields` | no | Busca valores almacenados en campos `Secret` que no sean sobres cifrados (los anteriores al cifrado). |
| `Migrations` | no | Cuenta ficheros en `migrations/`; los subdirectorios son espacios de nombres, no migraciones. |
| `WASM target` | no | `rustup target list --installed` contiene `wasm32-wasip2`, `wasm32-wasip1` o `wasm32-unknown-unknown`. |

La **matriz de features** se imprime siempre, coincida o no, porque es la
respuesta a “¿por qué `serve` se negó a arrancar?”. Un *mismatch* es crítico: el
proceso no podría servir lo que la configuración declara. Una contradicción
(`[mqtt]` pide arrancar y `[features] mqtt = false`) se imprime como nota en el
chequeo correcto, no como fallo, porque el servidor avisa y simplemente no
arranca el rol.

El comando no acepta flags propios (solo los globales) y termina con error si hay
algún chequeo crítico en fallo (`N critical checks failed`).

```text
=== Ferris Health Check ===
Path: /srv/billing

✓ PASS Rust toolchain [CRITICAL]
    rustc rustc 1.98.1 (…)
✗ FAIL Feature matrix [CRITICAL]
    compiled: api, web; unknown to this binary: `features.realtime` asks for…
```

## `ferris config`

| Subcomando | Efecto |
|---|---|
| `show` | Configuración efectiva en JSON, con las claves sensibles reconocidas redactadas. |
| `get <key>` | Valor o tabla de una clave con puntos (`server.port`, `database`). |
| `set <key> <value>` | Escribe una clave, validando antes el fichero resultante. |
| `reset` | Reescribe los valores por defecto, conservando `[database]` y `[redis]`. |
| `edit` | Abre el fichero en `$EDITOR` y valida al guardar. |

Todos operan sobre **el fichero que la CLI cargó**: `--config` o
`--dir`/`config/ferris.toml`. Nunca adivinan `./config/ferris.toml` si se indicó
otra ruta.

### `show`

Vuelca la configuración **fusionada** (fichero sobre valores por defecto, más
variables de entorno) como JSON en `stdout`, y la línea
`compiled features: …` en `stderr`. Esa separación mantiene
`ferris config show | jq` válido.

Se redactan:

* las claves con nombre sensible (`password`, `passwd`, `secret`, `jwt_secret`,
  `token`, `access_token`, `refresh_token`, `api_key`, `private_key`,
  `signing_key`), también dentro de `custom`;
* `redis.url` completa, porque el userinfo lleva la contraseña;
* en una URL de broker MQTT, solo el userinfo: `mqtts://user:<redacted>@host:8883`
  conserva el host, que es la mitad útil del informe.

::\:caution La redacción es por nombre de clave
`[secrets] key` y `[secrets] previous_keys` no están en esa lista, así que
`ferris config show` los imprime tal cual. Si tienes el keyring configurado, no
pegues la salida en un issue ni en un log sin quitarlos.
::\:

```bash
ferris config show
ferris config show | jq '.server'
```

### `get` y `set`

`get` resuelve rutas con puntos; una ruta que nombra una tabla imprime la
sección (`[database]` y sus claves), no “no encontrada”. Una clave inexistente es
un error.

`set` deduce el tipo: `true`/`false` → booleano, entero → entero, decimal →
float, el resto → cadena. Edita con `toml_edit`, así que conserva comentarios y
formato. Antes de escribir valida el documento completo: si el cambio dejaría la
configuración inválida (por ejemplo un booleano donde va una cadena), no se
escribe nada y el error lo dice.

```bash
ferris config get server.port
ferris config set server.port 9000
ferris config set features.mqtt true
```

Una clave con un segmento vacío (`a..b`, `.a`) se rechaza: no se puede direccionar
con `get` y no debe poder escribirse.

### `reset` y `edit`

`reset` pide confirmación y reescribe el fichero con los valores por defecto.
Conserva `[database]` y `[redis]`, porque describen los servicios de esta máquina
y un reset no debe repuntar un proyecto SQLite al PostgreSQL de ejemplo. Si una
de esas secciones no estaba en el fichero, no se inventa.

`edit` usa `$EDITOR` (por defecto `vim`) y acepta argumentos (`code --wait`,
`emacsclient -nw`). Al salir valida cargando la configuración; si no carga, el
comando falla. No “recarga” nada: el proceso que lee la configuración eres tú al
volver a ejecutar.

::\:tip Un cambio, un comando
`set` valida y escribe en un paso; para cambios grandes, `edit` conserva el
fichero entero y comprueba que sigue siendo cargable. `reset` es el único que
descarta lo que hubiera.
::\:
