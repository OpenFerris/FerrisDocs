---
title: Contribuir
description: Entorno Docker, gates obligatorios, flujo de pull request y organización del proyecto.
---

Ferris se desarrolla en Rust 2024 con un toolchain fijado en **1.98.1**. El
entorno canónico es el contenedor que define `Dockerfile`: tiene Rust, Node, los
targets de WebAssembly y las herramientas de componentes en las versiones
exactas. Compilar fuera de él introduce versiones distintas y artefactos que no
sirven para el resto del equipo.

## Preparar el entorno

La vía recomendada es el **devcontainer** de `.devcontainer/devcontainer.json`,
que construye la misma imagen y monta el repositorio en `/workspace`:

1. Abre el repositorio en VS Code.
2. Ejecuta **Dev Containers: Reopen in Container**.
3. Espera al `postCreateCommand`, que imprime `cargo --version`,
   `rustc --version` y `node --version`.

La alternativa sin editor es Docker Compose:

```bash
docker compose build
docker compose run --rm ferris bash
```

Dentro de la shell, el directorio de trabajo es `/workspace`:

```bash
rustc -V && cargo -V && node -v
cargo check -p ferris-core
```

`rustc -V` y `cargo -V` deben imprimir `1.98.1`; `node -v`, una versión `v24.x`.
El detalle de la imagen, los volúmenes y los permisos está en
[entorno de desarrollo](/contribuir/entorno/).

Para no repetir el prefijo, define una función en la shell del host:

```bash
dc() { docker compose run --rm ferris "$@"; }
dc cargo check -p ferris-core
```

## Gates

Un cambio no está terminado hasta que pasan los gates que le aplican. Todos se
ejecutan dentro del contenedor.

| Gate | Comando | Cuándo |
|---|---|---|
| Formato | `cargo fmt --all -- --check` | Siempre. |
| Lint | `cargo clippy --all-targets` | Siempre. |
| Typecheck | `cargo check --all-targets` | Siempre. |
| Crates pesadas | `cargo check-cli` | Si tocas `ferris-cli`, `ferris-server` o `ferris-wasm`. |
| Matriz de features | `cargo check -p ferris-cli --no-default-features --features api` y `--features full` | Si tocas features. |
| Hydrate | `cargo check -p ferris-web --features hydrate --target wasm32-unknown-unknown` | Si tocas código del Desk en navegador. |
| SSR | `cargo check -p ferris-web --features ssr` | Si tocas el puente SSR. |
| Binario SSR | `cargo check -p ferris-web --bin ferris-web-ssr --features ssr,wasm-runtime` | Si tocas `src/bin/ssr/**`. |
| Tests | `cargo test --workspace -j 2 -- --test-threads=1` | Siempre. |
| Versión | `cargo test -p ferris-wasm --test wit_version` | Siempre; obligatorio al subir la versión. |
| Módulos nativos | `cargo test -p ferris-api --test architecture` y `cargo test -p ferris-server --lib router::tests::modules` | Si tocas `ferris-api`, un adaptador `http` o el registro de módulos. |
| Estilo | `bash -lc 'cd ferris-web && node_modules/.bin/tailwindcss -i style/tailwind.css -o style/desk.css --minify'` | Si cambias clases o tokens. |
| Sitio de docs | `bash -lc 'cd ../FerrisDocs && npm run build'` | Si cambias una página, el sidebar o el tema. |
| Diff | `git diff` | Siempre; relee tu propio cambio. |

Con la función anterior, cada fila se lanza como `dc <comando>`, por ejemplo:

```bash
dc cargo test --workspace -j 2 -- --test-threads=1
dc cargo test -p ferris-document --lib
```

Los tests se ejecutan con `-j 2 -- --test-threads=1` para acotar la memoria y el
número de enlaces simultáneos. No es un parche para tests inestables: el
resultado debe depender del código, no de cuánta memoria haya libre. Las reglas
completas están en [pruebas](/contribuir/pruebas/).

## Flujo de pull request

1. **Parte de `develop`** y crea una rama descriptiva (`feature/…`, `fix/…`).
   `master` es producción: solo recibe merges de release o hotfix.
2. **Lee el código y la documentación** de la crate que vas a tocar
   (`AGENTS.md`, el repositorio `FerrisDocs` y el `README.md` de la crate). No
   dupliques una política que ya existe en otra capa.
3. **Haz el cambio más pequeño** que resuelve el problema, con su test de
   regresión si corrige un fallo.
4. **Ejecuta los gates** aplicables. No declares verde lo que no ejecutaste.
5. **Revisa el diff** antes de commitear: sin `target/`, sin `node_modules/`,
   sin `pkg/`, sin artefactos generados.
6. **Commit** con el formato del repositorio:

```text
feat(scope): qué cambia
fix(scope): qué se corrige
refactor(scope): qué se reorganiza
wip: trabajo en curso
```

El cuerpo explica el **porqué** y el alcance del cambio.

7. **Abre el PR** contra `develop`. La CI ejecuta formato, check, clippy
   (grupo correctness), matriz de features, hydrate/SSR, tests y estilo.

:::note
Este checkout puede no tener remoto configurado. Los repositorios canónicos
son <https://github.com/OpenFerris/FerrisFramework> y
<https://github.com/OpenFerris/FerrisCore>; no añadas un remoto ni hagas push
sin que se te pida.
:::

## Ramas

| Rama | Papel |
|---|---|
| `develop` | Integración y rama por defecto. Todo PR de trabajo va aquí. |
| `master` | Producción. Solo recibe merges de `release/*` y `hotfix/*`. |
| `feature/*`, `fix/*` | Trabajo diario, creado desde `develop`. |
| `release/*` | Congelación previa a publicar; se fusiona en `master` y se devuelve a `develop`. |
| `hotfix/*` | Parche urgente desde `master`; se fusiona en `master` y en `develop`. |

Los tres repositorios usan el mismo esquema. Un cambio que cruza Core y
Framework se prepara en ramas con el mismo nombre y se abre como dos PR
enlazados, empezando por `FerrisCore`.

## Reglas de revisión

- **Cero avisos nuevos.** El workspace declara `unused_crate_dependencies`,
  `unused_imports`, `dead_code` y el conjunto de clippy como `warn`; un PR no
  añade ninguno. Para probar una crate:
  `cargo clippy -p <crate> --all-targets -- -D warnings`.
- **Nada de `#[allow(...)]` desnudo.** Si un lint es incorrecto para el código,
  el `allow` lleva un comentario al lado explicando por qué.
- **Los ficheros no crecen de 600 líneas.** Si tu cambio lo empuja, parte el
  fichero en una carpeta con `mod.rs` fino y `pub use`.
- **Sin `unsafe`.** Si de verdad hace falta: bloque `// SAFETY:` por invariante,
  un test que lo ejercite y una nota explícita en el PR.
- **Sin dependencias nuevas sin justificar.** Va en
  `[workspace.dependencies]` con motivo, licencia, impacto en tamaño y build, y
  qué crate existente ya lo hacía.

El detalle de estilo —errores tipados, capas, frontend y tokens de color— está
en [estilo de código](/contribuir/estilo/).

## Verificar una afirmación

Antes de afirmar que algo está "sin cablear" o "sin usar", pruébalo con
`grep -rn "<símbolo>" --include='*.rs' .` sobre **todas** las crates y cita el
resultado. Un match de texto no es una prueba: hay que leer el trait, la
implementación y la llamada.

## Documentación

Si el cambio altera una interfaz pública —comando, flag, clave TOML, ruta,
tipo—, actualiza la página correspondiente del repositorio `FerrisDocs` en el
mismo cambio. Las reglas editoriales están en
[Documentación](/contribuir/documentacion/).

## Antes de decir "hecho"

- [ ] Todo se ejecutó dentro del contenedor (`rustc -V` y `cargo -V` dan `1.98.1`).
- [ ] Formato, clippy, check y tests en verde (o limitación declarada).
- [ ] Si tocaste el frontend, `desk.css` regenerado y commiteado.
- [ ] Si tocaste el contrato WIT, las dos copias de `ferris.wit` son idénticas.
- [ ] Si moviste la versión, los dos `Cargo.toml`, el paquete WIT y
      `FerrisDocs/project.json` comparten cifra y
      `cargo test -p ferris-wasm --test wit_version` pasa.
- [ ] Si tocaste `ferris-api` o una vertical, el test de arquitectura confirma
      que la API no volvió a depender de la feature.
- [ ] Si tocaste una página, `npm run build` del sitio pasa y el sidebar la enlaza.
- [ ] `git diff` releído.
- [ ] El informe final dice qué cambió, qué comandos se ejecutaron y qué quedó
      sin verificar.
