---
title: Estructura del proyecto
description: Qué genera ferris new, qué directorios aparecen en tiempo de ejecución y dónde acaba la app y empieza el framework.
---

## Lo que escribe `ferris new`

```text
my-app/
├── .cargo/
│   └── config.toml          # target = "wasm32-wasip2"
├── .gitignore
├── Cargo.toml               # crate cdylib, solo wit-bindgen
├── README.md
├── config/
│   └── ferris.toml          # database, server, apps
├── rust-toolchain.toml      # canal 1.98.1 + target wasm32-wasip2
├── src/
│   └── lib.rs               # el componente: describe + exports WIT
└── wit/
    └── ferris.wit           # copia del contrato ferris:framework@0.3.0
```

El `.gitignore` generado es:

```text
/target
Cargo.lock
*.db
.env
```

### `Cargo.toml`

```toml
[package]
name = "my-app"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]
path = "src/lib.rs"

[dependencies]
wit-bindgen = "0.62"

[workspace]
```

Dos rasgos del scaffold: `crate-type = ["cdylib"]` porque el artefacto es un
componente wasm, no un binario, y `[workspace]` vacío para que el proyecto sea
una crate independiente del workspace del framework.

### `.cargo/config.toml`

```toml
[build]
target = "wasm32-wasip2"
```

Así un `cargo build` normal produce el módulo core que el framework envuelve.

### `config/ferris.toml`

Tiene tres secciones en el scaffold: `[database]` (SQLite local), `[server]`
(host, puerto y `roles = ["api", "web", "realtime"]`) y `[apps]`
(`wasm_dir = "plugins"`, `enabled = []`). El resto de secciones —`[auth]`,
`[redis]`, `[files]`, `[secrets]`, …— toman sus defaults y se añaden
solo si las necesitas.

### `src/lib.rs`

El componente implementa el mundo `ferris-app`. Los exports son `describe`,
`handle_request`, `doctype_event`, `handle_stream`, `handle_stream_event`,
`handle_datagram`, `handle_job`, `ui_asset` y `ui_widget`. `describe()` declara
capacidades, rutas y DocTypes; no hay un `main` ni acceso directo a la base de
datos.

### `wit/ferris.wit`

Es una copia byte a byte de `ferris-wasm/wit/ferris.wit`
(`ferris:framework@0.3.0`). El paquete declara seis interfaces: `types`, `data`,
`schema`, `io`, `platform` y `descriptor`. No edites la copia a mano: si el
contrato cambia, vuelve a copiarla, o `ferris build` compilará contra una versión
distinta de la que ejecuta el host.

## Lo que aparece después

Nada de esto lo escribe el scaffold; lo crea el framework al arrancar o migrar:

```text
my-app/
├── my-app.db                # SQLite, tras `ferris migrate`
├── plugins/                 # [apps] wasm_dir
│   └── my-app/              # el "mundo" de la app (solo si se ejecuta)
│       ├── customizations/  # Custom Field / Property Setter exportados
│       ├── data/
│       ├── files/
│       └── secrets/
└── plugins/my-app.wasm      # lo escribe `ferris build`
```

- `plugins/<app>/` es el **mundo** de la app: el único sitio del disco que el
  guest puede escribir. Se monta en `/world` dentro del sandbox.
- `plugins/<app>.wasm` es el componente plano que escribe `ferris build`. Si
  existen los dos, gana el plano, de modo que una copia dentro del mundo nunca
  tapa un componente recién compilado.
- `customizations/*.json` se aplica con `ferris migrate`, no al arrancar.

:::note[Nombre de la app]
El nombre del directorio del mundo pasa por una validación de
`ferris_core::plugins` (letras, dígitos, `-`, `_`) antes de convertirse en
componente de ruta. Nada fuera del mundo es escribible a través de él.
:::

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
los ejecuta. Esto es lo que permite correrla en un sandbox con capacidades
explícitas.

## Los dos workspaces del framework

Ferris son **21 crates repartidos en dos repositorios**:

| Repositorio | Crates | Contenido |
|---|---|---|
| **FerrisCore** | 9 | `ferris-core`, `ferris-macro`, `ferris-db`, `ferris-schema`, `ferris-document`, `ferris-api`, `ferris-auth`, `ferris-web-shared`, `ferris-web-ui` |
| **FerrisFramework** | 12 | `ferris-web`, `ferris-realtime`, `ferris-jobs`, `ferris-scheduler`, `ferris-files`, `ferris-email`, `ferris-print`, `ferris-report`, `ferris-integrations`, `ferris-wasm`, `ferris-server`, `ferris-cli` |

Framework depende de Core por rutas `../../FerrisCore/ferris-*`; los dos
repositorios deben estar hermanos. La dirección del frontend sigue siendo
estricta: `ferris-web` → `ferris-web-ui` → `ferris-web-shared`.

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
