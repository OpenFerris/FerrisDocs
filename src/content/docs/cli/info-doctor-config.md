---
title: ferris info, doctor y config
description: Qué imprime info, qué comprueba doctor —con la matriz de features como chequeo crítico— y cómo show, set, get, reset y edit tratan el fichero de configuración y sus secretos.
---

Tres comandos de diagnóstico y configuración. Ninguno de ellos necesita que el
servidor esté corriendo.

## `ferris info`

Responde siempre, aunque falte una herramienta: si `rustc` no está en el `PATH`
lo dice, no se cae. Imprime cinco secciones:

| Sección | Contenido |
|---|---|
| `Version` | Nombre y versión del paquete de la CLI. |
| `Features` | Conjunto **compilado**, resumen de `[features]`, notas de contradicción y cada *mismatch*. |
| `Toolchain` | Salida de `rustc --version` y `cargo --version`, o el motivo por el que no se pudo. |
| `Project` | `name`, `version` y `description` leídos de `Cargo.toml`; si no hay proyecto, lo dice. |
| `Dependencies` | Primeras 20 líneas de `cargo tree --depth 1`. |

Solo imprime interruptores: ni credenciales, ni claves, ni rutas de certificado.
Es seguro pegarlo en un issue.

```text
=== Features ===
  compiled: api, email, files, integrations, jobs, print, realtime, report, scheduler, wasm, web
  configured: realtime=on jobs=on scheduler=on email=on files=on print=on report=on search=on webhooks=on
```

Un `mismatch` aquí es la misma condición que impide arrancar a `serve`: la
configuración pide un subsistema que este binario no compiló.

## `ferris doctor`

Ejecuta doce comprobaciones, en este orden, y devuelve un informe con `✓ PASS` /
`✗ FAIL`, la marca `[CRITICAL]` y un resumen.

| Chequeo | Crítico | Qué mira |
|---|---|---|
| `Rust toolchain` | sí | `rustc --version` funciona. |
| `Cargo` | sí | `cargo --version` funciona. |
| `Cargo.toml` | sí | Existe en el directorio actual, o el directorio es la raíz de un bench con `apps/`. |
| `Project structure` | sí | En la raíz del bench exige `apps/` y `sites/`; dentro de una app exige `src/` y avisa si falta `wit/ferris.wit`. |
| `Config files` | sí | Existe el `config/ferris.toml` que la CLI cargó. |
| `WIT version` | sí | `wit/ferris.wit` declara la misma `package ferris:framework@<version>` que enlaza el binario. |
| `Feature matrix` | sí | Lo compilado frente a lo que pide la configuración. |
| `Database configuration` | según el caso | SQLite: pasa siempre y es crítico solo si el fichero ya existe. Servidores: crítico si conecta; si no conecta, falla sin ser crítico. |
| `Redis` | no | Se salta como “not required: realtime is disabled”. Con realtime activo, hace `PING`. |
| `Secret fields` | no | Busca valores almacenados en campos `Secret` que no sean sobres cifrados (los anteriores al cifrado). |
| `Migrations` | no | Cuenta ficheros en `migrations/`; los subdirectorios son espacios de nombres, no migraciones. |
| `WASM target` | no | `rustup target list --installed` contiene `wasm32-wasip2`, `wasm32-wasip1` o `wasm32-unknown-unknown`. |

La **matriz de features** se imprime siempre, coincida o no, porque es la
respuesta a “¿por qué `serve` se negó a arrancar?”. Un *mismatch* es crítico: el
proceso no podría servir lo que la configuración declara. Un rol que la
configuración pide pero un gate apaga se imprime como nota en el chequeo
correcto, no como fallo, porque el servidor avisa y simplemente no arranca el
rol.

`WIT version` es crítico: una copia antigua del contrato compila sin errores y
produce un componente que el host no puede instanciar, con un fallo de linker al
arrancar. Dentro de una app, el chequeo compara la línea `package` de la copia
con la versión que el binario enlaza y nombra el fichero a reemplazar. En la raíz
del bench pasa sin comparar: cada app lleva su propio `wit/ferris.wit`, y se
revisa al ejecutar `doctor` dentro de `apps/<app>/`.

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

- las claves con nombre sensible (`password`, `passwd`, `secret`, `jwt_secret`,
  `token`, `access_token`, `refresh_token`, `api_key`, `private_key`,
  `signing_key`), también dentro de `custom`;
- `redis.url` completa, porque el userinfo lleva la contraseña.

:::caution La redacción es por nombre de clave
`[secrets] key` y `[secrets] previous_keys` no están en esa lista, así que
`ferris config show` los imprime tal cual. Si tienes el keyring configurado, no
pegues la salida en un issue ni en un log sin quitarlos.
:::

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
ferris config set features.print true
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

:::tip Un cambio, un comando
`set` valida y escribe en un paso; para cambios grandes, `edit` conserva el
fichero entero y comprueba que sigue siendo cargable. `reset` es el único que
descarta lo que hubiera.
:::
