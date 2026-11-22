---
title: ferris dev
description: Servidor de desarrollo con API, Desk y realtime en un solo puerto,
  y los tres modos de recarga en caliente del plugin y del frontend.
slug: 0.2/cli/dev
---

`ferris dev` arranca API, Desk y realtime en un puerto y recarga la app cuando
cambian sus fuentes. Debe ejecutarse **dentro de un proyecto** (`Cargo.toml` y
`wit/ferris.wit` presentes); si falta cualquiera de los dos, el comando falla con
un mensaje que dice cómo crear el proyecto.

```bash
ferris dev [--host HOST] [--port PORT] [--open] [--hot-reload MODE]
```

| Flag | Por defecto | Efecto |
|---|---|---|
| `--host <HOST>` | `0.0.0.0` | Dirección de escucha. |
| `-p`, `--port <PORT>` | `8000` | Puerto único para API, Desk y realtime. |
| `--open` | desactivado | Abre `http://<host>:<port>` en el navegador tras ~1,2 s. |
| `--hot-reload <MODE>` | `app` | `app`, `front` (alias `frontend`) o `both`. |

## Modo `app` (por defecto)

Es el ciclo corto: solo se recompila la app, no el framework.

1. Compila el componente con `cargo build --target wasm32-wasip2 --profile dev`
   y lo busca en `target/wasm32-wasip2/debug/<crate>.wasm` (el nombre del crate
   cambia `-` por `_`).
2. Copia el bundle de hidratación a `./pkg` si encuentra uno (`FERRIS_HYDRATE_DIR`,
   `ferris-web/pkg`, `ferris-web/target/site/pkg` o el propio `./pkg`). Sin
   bundle, el Desk se sirve solo en SSR y avisa una vez.
3. Fija los roles `api`, `web` y `realtime` — `server.roles` del fichero no se
   usa en desarrollo — y construye los settings con la base de datos y el JWT de
   `config/ferris.toml`.
4. Siembra un operador de desarrollo si la tabla de usuarios está vacía.
5. Prepara el mundo de la app en `plugins/<app>/` y publica el componente por la
   misma ruta que `ferris serve`, para que un fallo de registro no aparezca solo
   en producción.
6. Vigila `src/`, `wit/`, `Cargo.toml` y `Cargo.lock`; a cada cambio asienta
   250 ms de silencio y reconstruye una vez. Solo cuentan `.rs`, `.wit`, `.toml`
   y `.lock` que no sean ficheros temporales del editor.

Al terminar el arranque, el servidor marca `dev = true`: `/pkg` se sirve sin
caché, porque el bundle se reescribe en caliente.

::\:caution Operador sembrado
En desarrollo se crea `admin@local` con la contraseña `ferrisAdmin123` y el rol
`System Manager`. Es cómodo para el Desk local y **no** debe sobrevivir a
producción: cambia la contraseña o no reutilices esa base.
::\:

## Modo `front` (alias `frontend`)

Recompila el Desk (`ferris-web`) además de la app. Lo hace cargo-leptos: watcher
propio, compilación WASM, Tailwind, WebSocket de recarga y ciclo de vida del
servidor SSR. Como el SSR vive en el binario del servidor, este modo recompila y
reinicia el servidor de desarrollo.

Requisitos:

* `[cli] unlock_source = true` en la configuración, o `FERRIS_UNLOCK_SOURCE=1`;
* fuentes del framework localizables (`FERRIS_HOME` o el layout del repo) con
  `ferris-web/Cargo.toml`;
* Node/npm con `ferris-web/node_modules` instalado, para el Tailwind del proyecto
  que genera el CSS en vivo;
* `wasm32-wasip2` y, para la hidratación del navegador, el bundle de hidratación.

Si falta `unlock_source` o las fuentes, el comando **avisa y cae a `app`**; no
falla. `--host` debe ser una IP literal (cargo-leptos enlaza un `SocketAddr`, no
un nombre). El puerto de recarga sale de `[package.metadata.leptos]`
`reload-port` o, si no existe, 3001; si coincide con el puerto del sitio se
desplaza uno.

## Modo `both`

Hace el pipeline de `front` **y** mantiene el watcher de la app: al cambiar las
fuentes del plugin lo recompila y lo intercambia en el servidor SSR ya en
marcha mediante `POST /__dev/reload-app?token=…` en loopback, sin reiniciar el
proceso. Es el modo para tocar a la vez el Desk y la app.

```bash
# recarga de la app, puerto 8000
ferris dev

# Desk en 3000, abriendo el navegador
ferris dev --port 3000 --open --hot-reload front

# ambos, sin abrir navegador
ferris dev --hot-reload both
```

## Estilos en vivo

Con `unlock_source` activo, `ferris dev` compila `ferris-web/style/tailwind.css`
y sirve `desk.css` desde disco (`FERRIS_DESK_CSS_DEV`), reconstruyéndolo al
cambiar `ferris-web/style/`. Sin esa palanca sirve la hoja compilada dentro del
binario, y un cambio de clases no se ve hasta recompilar. Esto es independiente
de `--hot-reload`: aplica también al modo `app`.

## Qué no recarga

* Cambios en `config/ferris.toml`: hay que reiniciar el proceso.
* Migraciones: `ferris migrate` es un comando aparte.
* Cambios en el propio framework (crates `ferris-*`) en modo `app`: exigen
  recompilar la CLI; `front` los cubre solo para `ferris-web`.

::\:tip Proyecto en otro directorio
`ferris --dir /srv/app dev` funciona igual: la CLI se coloca en el proyecto
antes de detectarlo, así que `Cargo.toml`, `wit/` y `plugins/` se resuelven ahí.
::\:
