---
title: Primeros pasos
description: "Recorrido de tres pasos por Ferris: preparar el entorno, arrancar un proyecto y definir tu primer DocType."
---

Ferris es un framework web full-stack en Rust dirigido por metadatos. Tú declaras
**DocTypes** (el modelo de datos) y el motor de documentos aplica validación,
permisos, naming y ciclo de vida; el **Desk** genera formularios, listas y
dashboards a partir de esa misma declaración.

Esta sección es el camino corto desde una máquina vacía hasta un documento real
guardado en la base de datos y visible en el navegador.

## Los tres pasos

### 1. Prepara el entorno

Necesitas Rust **1.98.1** (el pin de `rust-toolchain.toml`), el target
`wasm32-wasip2`, una base de datos y, para el Desk, Node con sus dependencias.
El repositorio trae un dev container con todo eso instalado; fuera de él, la
instalación es la misma que la de cualquier proyecto Rust.

→ [Instalación](/getting-started/instalacion/)

### 2. Crea y arranca un proyecto

`ferris new` genera un componente WIT/WASM con su `config/ferris.toml`, `ferris
migrate` crea el esquema y `ferris dev` levanta API, Desk y realtime en un solo
puerto. `ferris dev` además siembra un operador de desarrollo para que el login
funcione sin configurar nada.

→ [Inicio rápido](/getting-started/inicio-rapido/)

### 3. Declara tu primer DocType

Un DocType se declara en Rust (struct con `#[doctype]` o un `DoctypeMeta` con
constructores) o se sirve desde el `describe()` de una app WASM. Con el metadato
registrado, `ferris migrate` crea la tabla y el CRUD queda disponible por la API
y por el Desk sin escribir HTML.

→ [Tu primer DocType](/getting-started/primer-doctype/)

## Qué vas a tener delante

| Pieza | Qué es | Dónde se toca |
|---|---|---|
| Motor de documentos | Valida, autoriza, nombra y ejecuta hooks | `ferris-document` |
| Metadatos | Registro de DocTypes y contrato de wire | `ferris-schema` |
| API HTTP | REST, JSON-RPC, batch y GraphQL | `/api/*` |
| Desk | Aplicación Leptos (SSR + hidratación) | `/desk`, `/login` |
| Plugins | Apps WASM con capacidades declaradas | `plugins/<app>/` |
| CLI | `new`, `dev`, `serve`, `migrate`, `doctor` | `ferris` |

:::tip[Lee el código, no solo la guía]
La fuente de verdad es este repositorio. Si una página y el código discrepan,
gana el código: `ferris-api/src/router/routes.rs` es la tabla de rutas completa y
`ferris-schema/src/fieldtype.rs` la lista canónica de fieldtypes.
:::

## Después de los tres pasos

- **Modelar más datos** → [DocTypes](/conceptos/doctypes/) y
  [campos y fieldtypes](/conceptos/campos-y-fieldtypes/).
- **Consumir la API desde fuera** → [API HTTP](/api/) y
  [autenticación](/api/autenticacion/).
- **Construir pantallas** → [Desk](/frontend/desk/) y
  [formularios](/frontend/formularios/).
- **Escribir una app WASM** → [apps WASM](/apps/) y
  [el contrato WIT](/apps/wit/).
- **Operar en producción** → [operaciones](/operaciones/) y
  [features del host](/referencia/host-features/).

:::caution[Estado 0.3.0 (pre-1.0)]
Ferris todavía no es 1.0: hasta esa versión, una **minor** puede cambiar la API
HTTP o el contrato de apps. Para algo de larga vida, fija un commit o un tag. La
política completa está en [Versionado](/referencia/versionado/).
:::

## Convenciones de esta documentación

- Las rutas, los nombres de campos JSON y los tipos van en `backticks`.
- Los ejemplos usan `http://localhost:8000`, el puerto por defecto de
  `[server] port` en `config/ferris.toml`.
- Los enlaces internos son absolutos y terminan en barra (`/api/recursos/`),
  porque el sitio se publica como estático con rutas de directorio.
- Todo lo que se afirma sobre endpoints sale de las rutas realmente montadas en
  `ferris-server` y `ferris-api`; lo que no existe se dice explícitamente.
