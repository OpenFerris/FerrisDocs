---
title: ferris new
description: Crea un proyecto Ferris nuevo como componente WIT/WASM, qué
  ficheros escribe exactamente y cuál es el siguiente paso para arrancarlo.
slug: 0.2/cli/new
---

`ferris new` genera el esqueleto de una **app Ferris**: un crate `cdylib` que
compila a `wasm32-wasip2` y se ejecuta como plugin dentro del servidor. La app no
enlaza el framework; importa sus servicios por el contrato `wit/ferris.wit`.

```bash
ferris new <name> [--into DIR]
```

| Argumento / flag | Efecto |
|---|---|
| `<name>` (posicional) | Nombre del proyecto. Se usa como `package.name`, en el `README` y en el nombre del fichero SQLite por defecto. |
| `--into <DIR>` | Directorio donde crear el proyecto. Por defecto `./<name>`. |

`--into` no es el `--dir` global: `--dir` mueve la CLI a un proyecto existente,
`--into` elige dónde nace el nuevo.

## Reglas del nombre

El nombre se valida antes de tocar el disco:

* no puede estar vacío;
* el primer carácter debe ser una letra ASCII;
* el resto solo admite letras ASCII, dígitos, `-` y `_`.

`ferris new mi_app` es válido; `ferris new 2app`, `ferris new mi app` o
`ferris new mi.app` fallan con un mensaje que dice qué carácter sobra. El nombre
se interpola en `Cargo.toml`, en `config/ferris.toml` y en `src/lib.rs`.

## Qué crea

```text
<name>/
├── .cargo/
│   └── config.toml
├── .gitignore
├── Cargo.toml
├── README.md
├── config/
│   └── ferris.toml
├── rust-toolchain.toml
├── src/
│   └── lib.rs
└── wit/
    └── ferris.wit
```

Además ejecuta `git init --initial-branch=main`, `git add .` y un commit
`Initial commit`. Si git no está instalado o no hay identidad configurada, avisa
y sigue: el proyecto queda igualmente usable.

Fichero por fichero:

* **`Cargo.toml`** — `crate-type = ["cdylib"]`, dependencia única
  `wit-bindgen = "0.62"` y una tabla `[workspace]` vacía para que el crate sea
  independiente del workspace del framework.
* **`.cargo/config.toml`** — `[build] target = "wasm32-wasip2"`, para que un
  `cargo build` normal produzca el módulo correcto.
* **`rust-toolchain.toml`** — canal `1.98.1`, componentes `rust-analyzer`,
  `clippy` y `rustfmt`, y el target `wasm32-wasip2`, para que rustup lo instale
  antes de la primera compilación.
* **`wit/ferris.wit`** — copia byte a byte del contrato del framework. Si no se
  encuentra el WIT de origen, `ferris new` falla **antes** de crear nada.
* **`src/lib.rs`** — invitado del mundo `ferris-app`: `describe()`,
  `handle_request`, `doctype_event`, `handle_stream`, `handle_stream_event` y
  `handle_job`. Declara sus capacidades (rutas, docstore, mundo propio, streams,
  scheduler, notificaciones, pubsub y MQTT) y crece a partir de ahí.
* **`config/ferris.toml`** — configuración de desarrollo con SQLite:

  ```toml
  [database]
  type = "sqlite"
  name = "<name>.db"
  host = ""
  port = 0
  user = ""
  password = ""
  max_connections = 5
  ssl_mode = "disable"

  [server]
  host = "0.0.0.0"
  port = 8000
  roles = ["api", "web", "realtime"]

  [apps]
  wasm_dir = "plugins"
  enabled = []
  ```

  `enabled = []` significa “todos los `.wasm` que haya en `plugins/`”: el
  proyecto no tiene que mantener una lista mientras desarrolla.
* **`.gitignore`** — `/target`, `Cargo.lock`, `*.db` y `.env`.
* **`README.md`** — qué es la app, qué capacidades pide y los tres comandos
  básicos (`dev`, `build`, `migrate`).

La creación es atómica: si cualquier paso falla, se borra el directorio recién
creado. Y si el destino ya existe, el comando se niega sin tocar nada.

## Siguiente paso

```bash
cd <name>
ferris build      # plugins/<name>.wasm
ferris dev        # API + Desk + realtime con recarga del plugin
```

`ferris dev` compila el componente con `cargo build --target wasm32-wasip2 --profile dev`, siembra un operador de desarrollo y sirve el Desk.

::\:caution Falta el secreto JWT
El `config/ferris.toml` que escribe el scaffold **no** incluye
`[auth] jwt_secret`, y `serve`, `run` y `dev` lo exigen para firmar sesiones. En
un proyecto recién creado, exporta uno de al menos 32 caracteres antes de
arrancar:

```bash
export FERRIS_JWT_SECRET="$(openssl rand -hex 32)"
```

O escríbelo en el fichero con `ferris config set auth.jwt_secret "<valor>"`.
::\:

Para preparar la base de datos antes de servir:

```bash
ferris migrate
ferris doctor
```

`migrate` aplica las migraciones generadas y las customizaciones que las apps
exportan en su mundo (`plugins/<app>/customizations/`); los detalles están en
[ferris migrate](/0.2/cli/migrate/). `doctor` confirma que el toolchain, el target
WASM y la configuración están en orden.

::\:tip Si rustup no tiene el target
Si `wasm32-wasip2` no está instalado en el toolchain que resuelve dentro del
proyecto, `ferris new` lo avisa al terminar. Añádelo con
`rustup target add wasm32-wasip2` antes de compilar.
::\:

## Qué no hace

* No crea una base de datos: solo escribe la configuración; el fichero SQLite
  aparece en el primer uso.
* No instala dependencias de Node ni compila el Desk: eso pertenece a
  `ferris dev --hot-reload front|both` y al pipeline de `ferris-web`.
* No añade el proyecto a un workspace existente; `[workspace]` lo mantiene
  aislado a propósito.
