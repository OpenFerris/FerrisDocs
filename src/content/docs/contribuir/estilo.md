---
title: Estilo de código
description: Reglas de Rust, errores, modularidad, dependencias y frontend que un cambio en Ferris debe respetar.
---

Las reglas de esta página no son preferencias: son el contrato del repositorio.
Un PR que las incumple se devuelve aunque compile.

## Idioma

- Código, identificadores, comentarios y doc comments en **inglés**.
- Documentación de usuario y mensajes de esta wiki, en español.
- Los `//!` de módulo explican **por qué** el diseño es así y qué fallo evita.
  El comentario que repite lo que el código ya dice sobra.
- Sin código comentado, `TODO` sin dueño ni `FIXME` que no se arregla en el
  mismo cambio.

## Errores

- Una sola taxonomía en `ferris-core/src/error.rs`: `Error` con una variante
  `#[from]` por dominio (`Config`, `Database`, `Tenant`, `Auth`, `Authz`,
  `Validation`, `Document`, `Schema`, `Migration`, `Job`, `Realtime`, `Email`…).
- Los errores de dominio usan `thiserror`. **`anyhow` solo en la capa de
  binario/orquestación**: `ferris-cli`, `ferris-server`, el host wasmtime de
  `ferris-wasm` y `ferris-web/src/bin/ssr.rs`.
- Las crates de librería (`ferris-core`, `ferris-db`, `ferris-document`,
  `ferris-api`, `ferris-schema`, `ferris-auth`, `ferris-web*`) no importan
  `anyhow`: devuelven errores tipados para que el llamador haga `match`.
- **Cada fallo externo se clasifica una sola vez, en el borde.**
  `ferris-db/src/error.rs::classify` es el modelo: el driver se convierte en
  `DatabaseError::{Constraint, PoolExhausted, Query}` allí, y nadie más parsea
  el texto del mensaje.
- El contexto se añade cuando cambia el significado; no se envuelve un error
  solo para volver a envolverlo igual.

```rust
// Bien: el llamador puede reaccionar a la variante
match ferris_db::error::classify(&error) {
    DatabaseError::Constraint(_) => DocumentError::AlreadyExists.into(),
    other => Error::Database(other),
}

// Mal: se pierde la variante y el llamador solo tiene un String
Error::Database(DatabaseError::Query(error.to_string()))
```

## Sin panics en rutas de librería

Nada de `unwrap()`, `expect()`, indexación que pueda salirse del rango ni
`panic!` en código alcanzable desde una petición. Un panic dentro de un
`OnceLock` o un `RwLock` envenena el estado del proceso y mata el logging para
el resto de su vida.

- Convierte la condición en un error tipado.
- Valida la entrada externa en el borde (HTTP, DB, WASM, metadatos) y confía en
  los invariantes dentro.
- Prefiere APIs fallibles a `chrono::Local` o a `slice[i]`.
- Un `unwrap()` en un test está bien cuando el fallo es el fallo del test.

## Sin éxito silencioso

Un validador que devuelve `Ok(())`, un hook que no hace nada, un flag que se
parsea y se ignora o una rama "no implementado" que finge funcionar son
defectos. Si falta una capacidad:

- falla de forma ruidosa, o
- devuelve `Unimplemented`/`Unsupported` tipado que el llamador deba manejar.

Un `--target serverless` que imprimiera "deployment completado" sería el éxito
silencioso que esta regla prohíbe.

## Abstracciones

- Dispatch estático y genéricos cuando el conjunto de tipos es cerrado; `dyn`
  solo para puntos de extensión abiertos (hooks, backends, traits de documento).
- Abstrae en la costura que **de verdad** varía: el contrato wire
  (`ferris_schema::contract`), la fachada `DocStore`, el dialecto. No añadas un
  trait con una sola implementación "por si acaso".
- **Nunca dupliques una política entre capas.** Dos APIs sobre el mismo concepto
  garantizan que una se salte. Unifica y delega.

## Rendimiento

- Evita `clone`/`to_string`/asignaciones innecesarias en rutas calientes; usa
  `&str` y datos prestados.
- Pero **mide antes de optimizar**: `ferris benchmark` existe.
- Las victorias algorítmicas mandan: no cargues N filas para filtrar en Rust si
  una consulta, un índice o un `GROUP BY` lo hacen.
- Vigila los N+1 (una consulta por DocType o por fila) y la inicialización por
  petición (`CustomizationStore::init()` en cada request es un defecto).
- Una caché sin invalidación real y sin re-init idempotente es un fallo extra,
  no una optimización.

## Concurrencia

- Nunca retengas un guard de `std::sync` a través de un `.await`. Usa
  `tokio::sync` o `parking_lot` a propósito y dilo en un comentario.
- El estado compartido va por `Arc`, inicializado una vez en
  `OnceLock`/`LazyLock`.
- El primer `install` gana; un segundo intento se rechaza y se registra, no se
  panic.

## `unsafe`

Prohibido por defecto. Si es imprescindible:

1. un bloque `// SAFETY:` por invariante,
2. un test que ejercite ese invariante,
3. una nota explícita en el PR.

## Tamaño y modularidad

- **Ningún fichero supera 600 líneas.** Si tu cambio lo empuja, pártelo en el
  mismo cambio.
- El split es carpeta + `mod` + `use`:

```rust
// ferris-<crate>/src/foo/mod.rs
mod bar;
mod baz;

pub use bar::{Bar, bar_helper};
pub use baz::*;
```

- Un `mod.rs` declara y reexporta; no contiene la implementación. Un `mod.rs`
  de 800 líneas es el anti-patrón.
- Los tests de un fichero van a `foo/tests.rs` con `#[cfg(test)] mod tests;`.
  Un fichero contiene código **o** tests, no ambos.
- El split conserva API pública, rutas de módulo y visibilidad, sin `#[allow]`
  nuevos.
- Aplica el mismo criterio a activos no Rust: CSS por `@layer`/`@import`, WIT
  por interfaz.

## Dependencias

- Se añaden solo en `[workspace.dependencies]`, con justificación escrita: qué
  sustituye, licencia, impacto en tamaño y tiempo de compilación, y si otra
  crate ya lo hace.
- Prefiere **rustls**. Nada que arrastre `native-tls`/OpenSSL.
- No subas el toolchain fijado ni edites `rust-toolchain.toml` para que compile
  sin decirlo muy alto.

## Frontend (Desk)

- Reutiliza los componentes de `ferris-web-ui/src/components/ui/`. Un primitivo
  nuevo va **dentro** de esa carpeta y se exporta desde `ui/mod.rs`, nunca
  inline en una vista.
- Los botones se declaran con `variants!` y clases literales en `button.rs`. No
  se concatenan clases en runtime ni se reestiliza un variant desde fuera.
- Solo tokens semánticos (`bg-background`, `text-foreground`, `bg-primary`…).
  Prohibidos `#hex`, `rgb()`, `oklch()`, estilos inline y clases de paleta con
  sombra (`bg-zinc-200`).
- Los estados de color viven en `components.css` con `var(--token)`, no en el
  Rust ni en variantes `dark:`.
- Los datos se leen **solo** por `DocStore`; nada de `fetch`/`reqwest` en una
  vista.
- Nada de DocTypes o campos hardcodeados: se leen del contrato `/api/*`.
- SSR e hydrate comparten markup; los globales del navegador viven en efectos o
  detrás del store de cliente.
- Accesibilidad y estados de carga/vacío/error son parte de "hecho".
- Si cambias clases o tokens, regenera `style/desk.css` y commitéalo.

## Tests

- Unitarios junto al código, en `#[cfg(test)] mod tests`; integración en
  `<crate>/tests/`.
- Servicios externos con `testcontainers`; nunca contra la base o el Redis del
  desarrollador.
- Deterministas: relojes inyectados, UUIDs fijos, sin `sleep`. La red solo por
  `wiremock`.
- Cada corrección lleva un test de regresión que falla sin ella.
- Se afirma sobre comportamiento y **variantes de error**, no sobre el texto del
  log.
