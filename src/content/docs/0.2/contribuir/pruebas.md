---
title: Pruebas
description: Cómo se ejecutan los tests de Ferris en Docker, reglas de
  determinismo, servicios externos, regresión y el fixture WIT.
slug: 0.2/contribuir/pruebas
---

La suite de Ferris se ejecuta dentro del contenedor de desarrollo y con una
concurrencia limitada para no agotar la memoria. Esta página explica los
comandos, las reglas de un test válido y las comprobaciones que no son parte de
`cargo test`.

## Comandos

```bash
# Suite completa: el gate
docker compose run --rm ferris cargo test --workspace -j 2 -- --test-threads=1

# Bucle rápido de una crate
docker compose run --rm ferris cargo test -p ferris-document --lib
docker compose run --rm ferris cargo test -p ferris-api --lib

# Un test concreto
docker compose run --rm ferris \
  cargo test -p ferris-db --lib -- sqlite_memory_does_not_become_a_file
```

`-j 2` limita cuántos binarios de test se enlazan y ejecutan a la vez;
`--test-threads=1` limita los hilos dentro de cada binario. La suite completa en
paralelo consume varios gigabytes y puede hacer que el motor Docker termine el
proceso por falta de memoria. No es un parche para tests inestables: el
resultado debe depender del código.

:::caution
No ejecutes la suite completa en paralelo "para ir más rápido". Además de la
memoria, el resultado dejaría de ser reproducible entre entornos.
:::

`--lib` compila y ejecuta solo los tests unitarios de la crate: es el bucle
interno recomendado mientras se desarrolla. Antes del PR, corre la suite
completa.

También puedes trabajar dentro de una shell para no repetir el prefijo:

```bash
docker compose run --rm ferris bash
cargo test -p ferris-document --lib
```

## Qué es un buen test

### Determinismo

* **Relojes inyectados**, no `Utc::now()` en la lógica bajo test.
* **UUIDs fijos** (v7 ya es dependencia) cuando el identificador importa.
* **Sin `sleep`.** Usa sincronización (canales, barreras, `Notify`), no timeouts.
* **Sin red**, salvo `wiremock` para un cliente HTTP.
* Sin dependencia del orden de ejecución ni del estado global de otro test. Si
  un test necesita un `OnceLock`, ese `OnceLock` debe tolerar que otro lo haya
  llenado (o el test debe probar la lógica pura en su lugar).

### Servicios externos

PostgreSQL, MySQL y Redis no deben apuntar nunca a la base de datos real de
quien desarrolla ni a un Redis compartido. La convención para aislarlos es
**testcontainers**: el test levanta su propio contenedor, lo usa y lo destruye.

```rust
// Esquema del patrón, no un helper que exista en todas las crates
let container = testcontainers::core::GenericImage::new("postgres", "16")
    .with_env_var("POSTGRES_PASSWORD", "test")
    .start()
    .await?;
```

:::note[Estado actual]
El workspace usa `wiremock` como única dependencia de simulación de red; hoy
no hay `testcontainers` en `[workspace.dependencies]` ni en `Cargo.lock`. Si un
test necesita un motor real, añadir esa dependencia exige la justificación
habitual de dependencias (licencia, tamaño, tiempo de compilación) y el test
debe seguir funcionando sin acceso a una base de datos de producción.
:::

Un test que necesita un motor ausente debe **fallar de forma clara** o quedar
marcado como ignorado con una razón; no debe pasar en silencio sin haber probado
nada.

### Regresión

Cada bug corregido lleva un test que falla **sin** el arreglo. El nombre describe
el comportamiento, no el ticket:

```rust
#[test]
fn a_verify_full_ssl_mode_is_not_downgraded_to_prefer() {
    // ...
}
```

Nada de `test_bug_123`. El ID del hallazgo va en el commit, no en el nombre del
test.

### Afirmaciones

* Sobre comportamiento y **variantes de error**, no sobre el texto del log.
* Un `assert!(result.is_err())` es débil: comprueba la variante concreta
  (`matches!(err, Error::Database(DatabaseError::Constraint(_)))`).
* Un test que solo comprueba que no panic no prueba la corrección.

## Dónde vive cada test

| Tipo | Ubicación |
|---|---|
| Unitario | `#[cfg(test)] mod tests` junto al código, o `foo/tests.rs` si el fichero ya es grande. |
| Integración | `<crate>/tests/<tema>.rs`. |
| Fixture WIT | `test/`, workspace separado y git-ignored. |

La regla de los 600 líneas también aplica a los tests: un fichero contiene
código o tests, no ambos. `ferris-document/src/engine/tests.rs` es el ejemplo de
lo que **no** hay que imitar por tamaño.

## El fixture WIT

`ferris-wasm/wit/ferris.wit` es el contrato de apps. `test/` es el scaffold
que `ferris new` genera (invitado WIT) y **no** forma parte del workspace
principal; en un clone limpio puede no existir.

Cuando cambia el contrato:

```bash
# Recompila el fixture para wasm32-wasip2
docker compose run --rm ferris \
  cargo build --target wasm32-wasip2 --manifest-path test/Cargo.toml

# Las dos copias deben ser byte a byte idénticas
cmp ferris-wasm/wit/ferris.wit test/wit/ferris.wit
```

`cmp` sin salida significa idénticas; con diferencia, imprime el primer byte
distinto. Copiar el fichero a mano y no compilar el fixture deja un scaffold que
no compila contra el contrato nuevo.

## La versión es una sola

`Cargo.toml` (`[workspace.package] version`) y el paquete
`ferris:framework@…` de las dos copias del WIT declaran la misma cifra. El test
`ferris-wasm/tests/wit_version.rs` falla si divergen o si las dos copias no son
idénticas; ejecútalo siempre que muevas la versión:

```bash
docker compose run --rm ferris \
  cargo test -p ferris-wasm --test wit_version
```

El significado de patch, minor y major está en
[Versionado](/0.2/referencia/versionado/).

:::note
`test/` está en `.gitignore` y en `exclude` del workspace. No lo añadas como
submódulo ni lo cablees al workspace raíz.
:::

## Frontend

```bash
# Hidratación en el navegador
docker compose run --rm ferris \
  cargo check -p ferris-web --features hydrate --target wasm32-unknown-unknown

# SSR y su binario
docker compose run --rm ferris cargo check -p ferris-web --features ssr
docker compose run --rm ferris \
  cargo check -p ferris-web --bin ferris-web-ssr --features ssr,wasm-runtime

# Test de paridad del sistema de diseño
docker compose run --rm ferris cargo test -p ferris-web --test design_system
```

El binario SSR no entra en `--all-targets` porque necesita `ssr,wasm-runtime`.
Si tocas el puente, ese check es obligatorio: hay tipos que solo compilan ahí.

El test `design_system` falla si `:root`/`.dark`, el fallback del cliente y
`@theme inline` se separan. Si añades un token, añádelo en los tres sitios.

## Estilo

```bash
docker compose run --rm ferris bash -lc \
  'cd ferris-web && node_modules/.bin/tailwindcss \
   -i style/tailwind.css -o style/desk.css --minify'
git diff --exit-code -- ferris-web/style/desk.css
```

`desk.css` se commitea. La CI comprueba que el fichero generado coincide con el
que produciría la build; un cambio de clases sin regenerarlo deja el diff sucio.

## Matriz de features

Si tocas una tabla `[features]` de Cargo o `ferris-cli/src/features.rs`:

```bash
docker compose run --rm ferris \
  cargo check -p ferris-cli --no-default-features --features api
docker compose run --rm ferris cargo check -p ferris-cli --features full
```

Son los dos extremos: el binario mínimo y el completo. Un gate que solo compila
en uno de los dos no está probado.

## Antes del PR

```bash
docker compose run --rm ferris cargo fmt --all -- --check
docker compose run --rm ferris cargo clippy --all-targets
docker compose run --rm ferris cargo check --all-targets
docker compose run --rm ferris cargo check-cli
docker compose run --rm ferris cargo test --workspace -j 2 -- --test-threads=1
```

Y, si aplica, hydrate, SSR, binario SSR, matriz de features y `desk.css`.

## Lo que no se puede verificar

Si un gate no se puede ejecutar (sin red para descargar crates, sin el target
wasm, sin un motor para testcontainers), dilo en el PR y en el informe. **No** lo
marques como verde. La frase "no ejecutado" es aceptable; "pasa" sin haberlo
ejecutado, no.
