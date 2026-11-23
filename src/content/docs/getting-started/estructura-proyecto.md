---
title: Estructura del proyecto
description: El layout de bench con apps/ y sites/, el de una app --standalone, qué escribe ferris build y dónde acaba la app y empieza el framework.
---

Un proyecto Ferris es un **bench**: un directorio que contiene una o varias apps,
sus sitios de despliegue y una única configuración. `ferris new <name>` construye
ese layout; `--standalone` conserva el antiguo de una app autocontenida.

## El bench

```text
bench/
├── .git/
├── .gitignore
├── config/
│   └── ferris.toml          # database, server, apps, i18n
├── apps/
│   └── billing/
│       ├── .cargo/
│       │   └── config.toml  # target = "wasm32-wasip2"
│       ├── .gitignore
│       ├── Cargo.toml       # crate cdylib, solo wit-bindgen
│       ├── README.md
│       ├── rust-toolchain.toml
│       ├── src/
│       │   └── lib.rs       # describe + exports WIT
│       └── wit/
│           └── ferris.wit   # copia del contrato del host
└── sites/                   # nace vacío
```

El repositorio git es **uno**, en la raíz. Un `.git` anidado en `apps/billing/`
escondería la app del historial del bench y dejaría `sites/` fuera de control de
versiones.

`config/ferris.toml` es la configuración de todo el bench: la leen `ferris
build`, `dev`, `app` y `site` desde cualquier subdirectorio de `apps/`, porque el
loader sube por el árbol hasta encontrarla. Una app del bench **no** lleva
`config/` propio.

El `.gitignore` del bench ignora los artefactos y, sobre todo, `sites/`:

```text
/target
/apps/*/target
*.db
.env

# Deployments: credentials, data, files and secrets
/sites/

# App dev worlds (the exported template lives in apps/<app>/world)
/apps/*/data/
/apps/*/files/
/apps/*/secrets/
/apps/*/world/data/
/apps/*/world/files/
/apps/*/world/secrets/
```

Un `site_config.json` lleva la contraseña de la base y la instancia de una app
lleva ficheros y secretos: nada de eso pertenece al repositorio.

### La app

`Cargo.toml` declara `crate-type = ["cdylib"]`, la dependencia `wit-bindgen` y un
`[workspace]` vacío para que la crate sea independiente. `.cargo/config.toml`
fija `wasm32-wasip2`, así que un `cargo build` normal produce el módulo core que
el framework envuelve en un componente.

`src/lib.rs` implementa el mundo `ferris-app`. Los exports son `describe`,
`handle_request`, `doctype_event`, `handle_stream`, `handle_stream_event`,
`handle_datagram`, `handle_job`, `ui_asset` y `ui_widget`. `describe()` declara
capacidades, rutas y DocTypes; no hay `main` ni acceso directo a la base de
datos.

`wit/ferris.wit` es una copia byte a byte del contrato del host. No la edites a
mano: si el contrato cambia, vuelve a copiarla. `ferris doctor` compara la
`package ferris:framework@<version>` de la copia con la que enlaza el binario y
falla si no coinciden.

## Lo que escribe `ferris build`

El build produce dos artefactos con propósitos distintos:

```text
apps/billing/
├── plugins/
│   └── billing.wasm     # componente de desarrollo
├── billing.wasm         # paquete de catálogo: el componente
├── plugin.toml          # manifest + [config] por defecto
├── world/               # PLANTILLA que se copia a un sitio
│   ├── customizations/
│   ├── data/
│   ├── files/
│   └── secrets/
└── assets/              # assets de UI, si la app los tiene
```

- `plugins/billing.wasm` es el artefacto plano del build (el que usa un
  `--standalone`); `ferris dev` compila y carga directamente desde
  `target/wasm32-wasip2/debug/`, sin pasar por él.
- `billing.wasm` + `plugin.toml` + `world/` forman el paquete que
  `ferris site install-app` copia. `plugin.toml` y `world/` existentes **no** se
  sobrescriben: el manifest guarda la versión y el operador puede haberlos
  ajustado.
- `world/customizations/` se rellena copiando `apps/billing/customizations/*.json`
  si existen. `data/`, `files/` y `secrets/` del template se crean vacíos.

## El mundo en desarrollo

`[apps] wasm_dir = "apps"` hace que el catálogo sea `apps/`. El **mundo** de una
app es `<wasm_dir>/<app>`, así que en el bench es el propio directorio
`apps/billing/`:

```text
apps/billing/
├── customizations/      # Custom Field / Property Setter exportados
├── data/
├── files/
└── secrets/             # nunca se sirve por HTTP
```

Se monta en `/world` dentro del sandbox y es lo único que el guest puede
escribir. Su layout y sus reglas están en
[Mundo, rutas y métodos](/apps/mundo-y-rutas/).

Un sitio no usa este directorio: al instalar la app, la plantilla `world/` se
copia a `sites/<site>/plugins/<app>/`, que pasa a ser el mundo del sitio. Ver
[Sitios](/configuracion/sites/).

## El layout `--standalone`

`ferris new --standalone billing` conserva el proyecto autocontenido:

```text
billing/
├── .git/
├── config/ferris.toml   # configuración propia
├── plugins/             # [apps] wasm_dir
├── src/
└── wit/
```

La configuración usa `wasm_dir = "plugins"`, el componente se escribe en
`plugins/billing.wasm` y el mundo en `plugins/billing/`. `ferris build` deja
además el paquete de catálogo en la raíz de la app (`billing.wasm`,
`plugin.toml`, `world/` y `assets/`), pero el host solo publica `plugins/`: no hay
`apps/` ni `sites/`. `ferris dev` se ejecuta dentro de `billing/` y
`ferris serve --all` publica `plugins/`. Es el layout para una app aislada, no
para un bench con varios sitios.

## Framework y app: quién hace qué

| Responsabilidad | Framework | App |
|---|---|---|
| Base de datos, pool, SQL | sí | no |
| Validación, permisos, naming, hooks | sí | declara reglas |
| Sockets, TLS, HTTP saliente | sí | pide política |
| Scheduler, jobs, notificaciones | sí | los invoca |
| DocTypes | los del framework | los suyos, vía `describe()` |
| Frontend | Desk (`ferris-web`) | assets y widgets opcionales |

La app es **compute puro**: pide servicios por las importaciones WIT y el host
los ejecuta. Eso es lo que permite correrla en un sandbox con capacidades
explícitas.

## Los dos workspaces del framework

Ferris son **21 crates repartidos en dos repositorios**:

| Repositorio | Crates | Contenido |
|---|---|---|
| **FerrisCore** | 9 | `ferris-core`, `ferris-macro`, `ferris-db`, `ferris-schema`, `ferris-document`, `ferris-api`, `ferris-auth`, `ferris-web-shared`, `ferris-web-ui` |
| **FerrisFramework** | 12 | `ferris-web`, `ferris-realtime`, `ferris-jobs`, `ferris-scheduler`, `ferris-files`, `ferris-email`, `ferris-print`, `ferris-report`, `ferris-integrations`, `ferris-wasm`, `ferris-server`, `ferris-cli` |

Framework depende de Core por rutas `../../FerrisCore/ferris-*`; los dos
repositorios deben estar hermanos. La dirección del frontend es estricta:
`ferris-web` → `ferris-web-ui` → `ferris-web-shared`.

En Framework, `default-members` incluye cinco crates (`ferris-web`,
`ferris-realtime`, `ferris-jobs`, `ferris-scheduler`,
`ferris-integrations`). Los verticales pesados, wasm, server y CLI se compilan
con `cargo check-cli`.

:::tip[No mezcles los dos árboles]
Un proyecto `ferris new` no es miembro del workspace del framework y no debe
serlo. Si necesitas compartir código, publica una crate o cópialo; meter el
proyecto en el workspace del framework rompe el pin de toolchain y la caché.
:::

## Siguiente paso

Con la estructura clara, declara datos:
[tu primer DocType](/getting-started/primer-doctype/).
