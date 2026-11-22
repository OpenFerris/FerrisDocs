---
title: Visión general
description: Qué es Ferris, qué principios sostienen su diseño y por dónde entrar según lo que vayas a hacer.
---

Ferris es un framework web full-stack escrito en Rust, dirigido por metadatos y
modelado sobre Frappe Framework. Un **DocType** describe los datos (campos, tipos,
permisos, naming); el motor de documentos aplica validación, ciclo de vida,
permisos y control de cambios; y el **Desk** genera formularios, listas y
dashboards a partir de esa misma descripción. Las apps externas se ejecutan como
componentes **WASM** arenados que declaran sus propios DocTypes, rutas, métodos,
widgets y hooks.

Datos de versión de esta documentación:

| Dato | Valor |
|---|---|
| Ferris | `0.3.0` (pre-1.0) |
| Toolchain | Rust `1.98.1`, edición 2024 |
| Workspace | 21 crates |
| Contrato WIT | `ferris:framework@0.3.0` |
| Licencia | MIT |

## Principios

### Los metadatos son la fuente única

Un DocType existe una sola vez, como `ferris_schema::DoctypeMeta`. De esa
declaración salen la tabla física, la validación, el formulario, las columnas de
la lista, los filtros y el payload que consume el navegador. Nada de eso se
escribe a mano en una vista: si un campo no está en la metadata, no se renderiza.

Hay tres formas de producir esa metadata y las tres desembocan en el mismo tipo:

- el proc-macro `#[doctype]` compila un `struct` a `DoctypeMeta` y lo registra;
- los builders de `ferris_schema` (`DoctypeMeta::new(..).field(..)`) construyen lo
  mismo en código;
- `describe()` de un plugin WASM lo envía por el contrato WIT y el host lo
  registra al cargar la app.

Las personalizaciones en runtime (`Custom Field`, `Property Setter`,
`Custom DocPerm`) no sustituyen esa metadata: se **aplican encima** para producir
la metadata *efectiva* que usa cada petición.

### El host compone; la feature declara

`ferris-api` define el contrato `Module` y la API genérica, pero no conoce
`print`, `report` ni ninguna otra vertical. Cada feature implementa el trait en
su crate y `ferris-server` la monta bajo `/api` con las mismas capas de auth y
CSRF. La API no depende de la feature; la feature depende de la API. Ver
[Módulos nativos](/arquitectura/modulos-nativos/).

### Un solo motor para lo tipado y lo dinámico

`ferris_document::crud` (el camino de un `#[doctype]` tipado) y la ruta REST
dinámica (`/api/resource/...`) no son dos implementaciones. Ambas serializan a
`ferris_core::Value` y llaman al mismo `DocumentEngine`. Por eso comparten tabla,
naming, validación, hooks y permisos: una regla añadida en un sitio aparece en el
otro sin trabajo extra, y no existe la posibilidad de que una de las dos quede
obsoleta.

### Seams explícitos

El framework abstrae solo donde algo varía de verdad:

- `ferris_schema::contract` — el contrato de cable entre servidor y navegador;
- `DocStore` (`ferris-web/src/api/store.rs`) — acceso a datos para SSR y hydrate;
- `Dialect` (`ferris-db/src/dialect.rs`) — PostgreSQL, MySQL o SQLite;
- `VirtualDoctypeProvider` / `VirtualFieldProvider` — fuentes de datos y campos
  calculados;
- `ferris_core::hooks` — puntos de extensión del ciclo de vida.

No hay traits "por si acaso" con una única implementación.

### Fail-closed

El motor deniega por defecto. Sin usuario en el `EngineContext`, una escritura
falla con error de autorización salvo que el contexto active `allow_anonymous`
explícitamente. Un `DocPerm` que no concede nada no concede nada. Un valor fuera
de la lista canónica de fieldtypes se rechaza en las rutas estrictas en lugar de
degradarse a texto. Un documento enviado solo admite cambios en campos
`allow_on_submit`; uno cancelado está bloqueado por completo.

### `ferris-core` sin I/O (con una excepción documentada)

`ferris-core` es la base del grafo y contiene tipos, errores, permisos, hooks,
valores, temas y configuración. Todo es puro salvo dos lecturas de arranque que
ninguna capa superior puede hacer por él: la carga de `ferris.toml`/`ferris.yaml`
más variables `FERRIS_*`, y el registro de tenants (`<root>/<id>.json`). Ambas son
`std::fs` síncrono, así que no deben ejecutarse desde una ruta de petición async.

## Mapa del sistema

```text
                    ┌──────────────────────────────────────────┐
   navegador ──────▶│  ferris-server  (axum, roles, features)   │
                    └───────────────┬──────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
      ferris-web (Desk)      ferris-api (REST)     ferris-realtime
      SSR / hydrate          authz, rutas          socket.io
              │                     │
              └──────────┬──────────┘
                         ▼
                   DocStore / DocumentEngine          ◀── ferris-document
                         │
          ┌──────────────┼───────────────┬─────────────────┐
          ▼              ▼               ▼                 ▼
   ferris-schema    ferris-core     ferris-db        ferris-wasm
   registry,        errores,        pool, SQL,       host wasmtime,
   contrato,        permisos,       migraciones      contrato WIT
   migraciones      hooks, valores
                         ▲
                         │
                   ferris-macro (#[doctype], #[workflow], #[permission], #[job])
```

Alrededor del núcleo viven las verticales: `ferris-auth`, `ferris-jobs`,
`ferris-scheduler`, `ferris-files`, `ferris-email`, `ferris-print`,
`ferris-report` y `ferris-integrations`. `ferris-cli` orquesta
todo desde fuera del proceso servidor.

## Por dónde empezar

**Si vas a modelar datos** — lee [DocTypes](/conceptos/doctypes/), luego
[campos y fieldtypes](/conceptos/campos-y-fieldtypes/) y
[naming](/conceptos/naming/). El [modelo de datos](/arquitectura/modelo-de-datos/)
explica qué acaba en la base de datos.

**Si vas a escribir lógica de negocio** — empieza por
[controladores y hooks](/conceptos/controladores/) y
[DocStatus](/conceptos/docstatus/); después
[workflows](/conceptos/workflows/) si el documento tiene estados.

**Si vas a construir una pantalla** — el Desk se alimenta de
`GET /api/doctype/meta/{doctype}`; revisa
[Actions, Links y Customize](/conceptos/actions-links-customize/) para saber qué
llega en ese payload.

**Si vas a contribuir al framework** — [las 21 crates](/arquitectura/crates/)
primero, y después el [ciclo de vida](/arquitectura/ciclo-de-vida/) y
[el viaje de una petición HTTP](/arquitectura/peticion-http/), que son los dos
recorridos donde un cambio suele romper algo.

**Si vas a operar un despliegue** — importa la matriz de features de compilación:
una feature decide si un subsistema existe en el binario, y la configuración
`[features]` solo puede apagarlo, nunca añadirlo.

:::caution[Estado pre-1.0]
Hasta `1.0.0` una minor puede cambiar la API pública o el contrato WIT. Fija un
commit o un tag para cualquier despliegue duradero; la regla exacta está en
[Versionado](/referencia/versionado/).
:::
