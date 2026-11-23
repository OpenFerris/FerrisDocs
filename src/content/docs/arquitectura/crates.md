---
title: Las 21 crates
description: Qué hace cada crate del workspace, de qué depende y por qué el grafo está partido en dos velocidades.
---

Ferris se distribuye en **dos workspaces** que comparten `resolver = "2"`,
edición 2024 y versión `0.4.0`:

| Repositorio | Crates | Papel |
|---|---:|---|
| **FerrisCore** | 9 | Base mínima: núcleo, DB, schema, documentos, API, auth y la capa UI compartida. Sin verticales ni host wasm. |
| **FerrisFramework** | 12 | Fachada pública: Desk, verticales, host wasm, servidor y CLI. Depende de FerrisCore por `path`. |

En total son 21 crates. `FerrisDocs` es el tercer repositorio (Astro/Starlight)
y no es un workspace de Rust.

## Tabla

La columna **depende de** lista solo crates internos del workspace.

| Crate | Responsabilidad | Depende de |
|---|---|---|
| `ferris-core` | Taxonomía de errores, config, hooks, primitivas de permisos, tenant, workspaces, temas, `Value` y los puertos `QueuePort`/`MailerPort`/`ServiceHandles`. Casi todo puro. | — |
| `ferris-macro` | Proc-macros `#[doctype]`, `#[workflow]`, `#[permission]`, `#[job]`. | — |
| `ferris-db` | Pool, `Dialect`, builders SQL, migraciones y la **única** clasificación de `sqlx::Error`. | `core` |
| `ferris-schema` | Registro de DocTypes, `DoctypeMeta`/`FieldMeta`, contrato de cable, personalización y runner de migraciones. | `core`, `db` |
| `ferris-document` | Motor de documentos: `engine/`, `crud.rs`, `document/`, `naming/`, `validation/`, `workflow/`, `versioning`. | `core`, `db`, `schema` |
| `ferris-api` | Fachada REST, contrato `Module` de módulos nativos, `authz/`, `doc_meta.rs`, `custom_docperm.rs`, `store::DocStore`. | `core`, `db`, `auth`, `schema`, `document` |
| `ferris-auth` | Sesiones, OAuth2/PKCE, MFA, hashing de contraseñas, CSRF. | `core`, `db`, `document`, `schema` |
| `ferris-realtime` | Servidor socket.io, eventos y notificaciones de documento. | `core`, `auth` |
| `ferris-jobs` | Cola de trabajos sobre Redis, con dead-letter y el adaptador `QueuePort`. | `core`, `db` |
| `ferris-scheduler` | Cron sobre `ferris-jobs`. | `core`, `db`, `jobs` |
| `ferris-files` | Object storage S3-compatible, descargas firmadas y `FilesModule` (feature `http`: API del Desk, ruta pública y ciclo de vida). | `core`, `db`, `schema` (+ `api` con `http`) |
| `ferris-email` | Envío SMTP y DocTypes de cuenta de correo. | `core`, `schema`, `jobs` |
| `ferris-print` | Formatos de impresión editables (MiniJinja + Typst) a PDF/SVG/PNG/HTML y `PrintModule` con la feature `http`. | `core`, `schema` (+ `api` con `http`) |
| `ferris-report` | Query Reports guardados, ejecución, exportación y `ReportModule` con la feature `http`. | `core`, `db` (+ `api` con `http`) |
| `ferris-integrations` | OAuth/Google/LDAP/webhook: DocTypes y adaptadores. | `core`, `schema`, `auth`, `db`, `document`, `jobs` |
| `ferris-wasm` | Host wasmtime, `wit/ferris.wit`, capacidades, rutas declaradas. | `core`, `db`, `schema`, `auth`, `document`, `jobs`, `scheduler` |
| `ferris-server` | Constructor del router axum, roles, capas globales, arranque. | todas las anteriores salvo `cli` (las UI llegan vía `ferris-web`) |
| `ferris-cli` | `ferris new/dev/serve/run/build/migrate/generate/deploy/tenant/shell/benchmark/info/doctor/config`. | `core`, `db`, `auth`, `schema`, `document`, `jobs`, `server`, `wasm`; `print` es opcional |
| `ferris-web-shared` | Contrato de cable y helpers de metadata para el navegador. **Sin Leptos, sin `web-sys`.** | `schema` |
| `ferris-web-ui` | ~90 componentes (`components/ui`), hooks (`components/hooks`), catálogo de clases. Sin routing ni fetching. | `web-shared` |
| `ferris-web` | Desk: rutas, estado, fachada `DocStore`, entrypoints, CSS. | `web-ui`, `web-shared`, `schema` (+ `core`, `api`, `auth`, `db`, `document`, `wasm` opcionales para SSR) |

`ferris-api` no depende de ninguna vertical: cada feature implementa
`ferris_api::Module` y `ferris-server` la compone. Los detalles están en
[Módulos nativos](/arquitectura/modulos-nativos/).

## Dirección del frontend (no se invierte)

```text
ferris-web  ──▶  ferris-web-ui  ──▶  ferris-web-shared  ──▶  ferris-schema
   rutas            componentes         contrato puro          metadata
   estado           hooks               sin Leptos             serializable
   DocStore         catálogo            sin web-sys
```

`ferris-web-ui` no puede importar routing, `ferris-api` ni nada nativo;
`ferris-web-shared` no puede importar Leptos ni `web-sys`. `ferris-web`
re-exporta las otras dos bajo sus rutas de módulo, así que mover un componente
no rompe las vistas, pero invertir la flecha rompe la compilación a wasm.

## `default-members` y las dos velocidades

En **FerrisCore** los 9 crates son `default-members`: `cargo check` compila toda
la base. En **FerrisFramework** el default es deliberadamente barato e incluye
5 crates:

- `ferris-web`, `ferris-realtime`, `ferris-jobs`, `ferris-scheduler`,
  `ferris-integrations`.

Quedan fuera del default `ferris-files`, `ferris-email`, `ferris-print`,
`ferris-report`, `ferris-wasm`, `ferris-server` y `ferris-cli`. El motivo es
tiempo de compilación: wasmtime con cranelift arrastra decenas de crates y no
hace falta para tocar el motor de documentos. Cuando toques server/CLI/wasm o
una vertical pesada, usa el alias del workspace de Framework:

```bash
cargo check-cli   # -p ferris-cli -p ferris-server -p ferris-wasm --all-targets
```

Los crates de Framework referencian Core con rutas relativas
(`../../FerrisCore/ferris-*`), así que los dos repositorios deben estar uno al
lado del otro en el checkout de desarrollo.

:::tip
Si un cambio toca `ferris-cli/src/features.rs` o una tabla `[features]`,
hay que comprobar además la matriz mínima:
`cargo check -p ferris-cli --no-default-features --features api` y
`cargo check -p ferris-cli --features full`.
:::

## Macro vs schema

Son dos crates con responsabilidades distintas y sin dependencia entre ellas:

- `ferris-macro` solo depende de `syn`, `quote` y `proc-macro2`. No conoce el
  framework: emite código que **nombra** `ferris_schema::DoctypeMeta`,
  `ferris_core::PermissionRule` y `ferris_document::Document` por ruta absoluta,
  y el crate que usa la macro es quien resuelve esas rutas.
- `ferris-schema` es el dueño del dato: define `DoctypeMeta`, `FieldMeta`,
  `IndexMeta`, el contrato `contract::*`, el registro global y las migraciones.

La expansión de `#[doctype]` crea un `OnceLock<DoctypeMeta>` que se inicializa en
el primer uso y llama a `ferris_schema::registry::register_doctype`. Es decir: la
macro genera el *literal*, el schema define el *tipo* y el registro lo publica.

## Crates de verticales

Cada vertical es opcional y aporta una feature Cargo con su nombre en
`ferris-server` y `ferris-cli`: `email`, `files`, `print`, `report`,
`integrations`, `wasm` (más `api`, `web`, `realtime`, `jobs`, `scheduler` y el
alias `full`). Un binario sin la feature no tiene el rol ni las rutas:
`features.search = true` en la config de un build sin `search` no enciende nada, y
un gate de `[features]` sobre un binario sin esa feature falla en el arranque con
un mensaje que pide recompilar.

`ferris-scheduler` y `ferris-email` implican `jobs`, porque ambos corren sobre la
cola.

## Dos casos que conviene mirar de cerca

**`ferris-integrations`** mezcla DocTypes (credenciales, webhooks) con adaptadores
de runtime, por eso depende de `auth`, `db`, `document` y `jobs` a la vez. Es la
vertical con más aristas del workspace.

**`test/`** no es miembro ni submódulo: está en `exclude = ["test"]` y en
`.gitignore`, y es el scaffold que genera `ferris new` (un guest WIT). Su
`test/wit/ferris.wit` debe seguir siendo byte-idéntico a
`ferris-wasm/wit/ferris.wit`; se comparan con `cmp` cuando cambia el contrato.

## Cómo leer el grafo

Si una crate necesita algo de otra que está por encima, la respuesta casi nunca
es añadir la arista: se mueve el tipo al seam correcto. `ferris-core` no puede
depender de `ferris-auth`, y por eso `check_permission` vive en `core` junto al
motor que gobierna. `ferris-document` no puede depender de `ferris-auth`, y por
eso el usuario llega como `ferris_core::User` en el `EngineContext`.
