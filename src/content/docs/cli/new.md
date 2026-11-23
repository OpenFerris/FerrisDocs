---
title: ferris new
description: Crea un bench con apps/, config/ y sites/, o una app --standalone, y qué escribe exactamente cada layout.
---

`ferris new` genera el esqueleto de una **app Ferris**: un crate `cdylib` que
compila a `wasm32-wasip2` y se ejecuta como plugin dentro del servidor. Por
defecto crea además el **bench** que la contiene: la carpeta `apps/`, la
configuración única y `sites/`.

```bash
ferris new <name> [--into DIR] [--standalone]
```

| Argumento / flag | Efecto |
|---|---|
| `<name>` (posicional) | Nombre de la app. Es `package.name`, el nombre del directorio y el del futuro `<name>.wasm`. |
| `--into <DIR>` | Directorio de la app. Tiene prioridad sobre el cálculo por defecto. |
| `--standalone` | Crea una app autocontenida en `./<name>/`, con su `config/ferris.toml` y `wasm_dir = "plugins"`. |

`--into` no es el `--dir` global: `--dir` mueve la CLI a un proyecto existente,
`--into` elige dónde nace el nuevo.

## Reglas del nombre

El nombre se valida antes de tocar el disco:

- no puede estar vacío;
- el primer carácter debe ser una letra ASCII;
- el resto solo admite letras ASCII, dígitos, `-` y `_`.

`ferris new mi_app` es válido; `ferris new 2app`, `ferris new mi app` o
`ferris new mi.app` fallan con un mensaje que dice qué carácter sobra. El nombre
se interpola en `Cargo.toml`, en `src/lib.rs` y, en el layout standalone, en la
configuración.

## Layout por defecto: bench

El directorio de trabajo es la raíz del bench. `ferris new billing` crea:

```text
<bench>/
├── .git/                  # un repositorio para todo el bench
├── .gitignore
├── config/
│   └── ferris.toml        # config única (no se sobrescribe si ya existe)
├── apps/
│   └── billing/
│       ├── .cargo/config.toml
│       ├── .gitignore
│       ├── Cargo.toml
│       ├── README.md
│       ├── rust-toolchain.toml
│       ├── src/lib.rs
│       └── wit/ferris.wit
└── sites/
```

Si ya existe un bench por encima del directorio actual, `ferris new` usa **ese**
(`config/ferris.toml` encontrado al subir), no crea otro. El `.gitignore` del
bench ignora `/sites/` y los datos de las apps, porque llevan credenciales y
ficheros.

La configuración que escribe es la del catálogo, con SQLite para arrancar sin
servicios externos:

```toml
[database]
type = "sqlite"
name = "ferris.db"
# …

[server]
host = "127.0.0.1"
port = 8000
roles = ["api", "web", "realtime"]

[apps]
wasm_dir = "apps"
enabled = []

[i18n]
default_locale = "en"
supported = ["en", "es"]
```

`wasm_dir = "apps"` convierte `apps/` en el catálogo global que leen
`ferris build` y `ferris site install-app`.

## Layout `--standalone`

```text
<name>/
├── .git/
├── .cargo/config.toml
├── .gitignore
├── Cargo.toml
├── README.md
├── config/ferris.toml     # propio, con wasm_dir = "plugins"
├── rust-toolchain.toml
├── src/lib.rs
└── wit/ferris.wit
```

No crea `apps/` ni `sites/`; el repositorio git se inicializa dentro de la app y
la configuración usa el layout histórico `plugins/`. Es la opción para una app
aislada que se sirve sola, no para un bench con varios sitios.

## Fichero por fichero

- **`Cargo.toml`** — `crate-type = ["cdylib"]`, dependencia única
  `wit-bindgen = "0.62"` y una tabla `[workspace]` vacía para que el crate sea
  independiente del workspace del framework.
- **`.cargo/config.toml`** — `[build] target = "wasm32-wasip2"`, para que un
  `cargo build` normal produzca el módulo correcto.
- **`rust-toolchain.toml`** — canal `1.98.1`, componentes `rust-analyzer`,
  `clippy` y `rustfmt`, y el target `wasm32-wasip2`.
- **`wit/ferris.wit`** — copia byte a byte del contrato del host. Si no se
  encuentra el WIT de origen, `ferris new` falla **antes** de crear nada.
- **`src/lib.rs`** — invitado del mundo `ferris-app`: implementa los nueve
  exports y declara sus capacidades. El scaffold incluye una ruta HTTP en
  `/apps/<name>` y un stream WebSocket en `/ws`.
- **`.gitignore` de la app** — `/target`, `Cargo.lock`, `*.db` y `.env`.
- **`README.md`** — qué es la app, qué capacidades pide y los comandos del bench.

La creación es atómica: si cualquier paso falla, se borra lo que se creó en esa
invocación (incluida la configuración, si la escribió este comando) y no se toca
lo que ya existía. Si el destino ya existe, el comando se niega.

## Siguiente paso

Desde la raíz del bench:

```bash
ferris dev --app billing      # compila y recarga; siembra el admin de desarrollo
ferris build --app billing    # paquete de catálogo en apps/billing/
```

Con varias apps bajo `apps/`, `--app` es obligatorio o hay que entrar en
`apps/<app>/`. En un `--standalone`, ejecuta `ferris dev` y `ferris build` dentro
de la app, sin `--app`. El recorrido completo, con migración y sitio, está en
[inicio rápido](/getting-started/inicio-rapido/).

:::tip Secreto JWT de desarrollo
La configuración que escribe el scaffold **no** incluye `[auth] jwt_secret`, y
`serve`/`run` lo exigen para firmar sesiones. `ferris dev` es la excepción: si
falta, genera un secreto efímero solo en memoria y avisa. Para conservar sesiones
(y para `ferris serve`), define uno estable:

```bash
export FERRIS_JWT_SECRET="$(openssl rand -hex 32)"
```

O escríbelo con `ferris config set auth.jwt_secret "<valor>"`.
:::

:::tip Si rustup no tiene el target
Si `wasm32-wasip2` no está instalado en el toolchain del proyecto, `ferris new`
lo avisa al terminar. Añádelo con `rustup target add wasm32-wasip2` antes de
compilar.
:::

## Qué no hace

- No crea la base de datos: solo escribe la configuración; el fichero SQLite
  aparece en el primer uso.
- No migra el esquema: eso es `ferris migrate`.
- No instala dependencias de Node ni compila el Desk.
- No añade el proyecto a un workspace existente; `[workspace]` lo mantiene
  aislado a propósito.
