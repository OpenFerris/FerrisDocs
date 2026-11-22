# Documentación de Ferris

Sitio de documentación oficial del framework **Ferris**, construido con
[Astro](https://astro.build) y [Starlight](https://starlight.astro.build).
Publicado en **<https://openferris.github.io/FerrisDocs/>**.

Este repositorio es independiente de los dos workspaces de Rust:

| Repositorio | Contenido |
|---|---|
| [`FerrisCore`](https://github.com/OpenFerris/FerrisCore) | Base mínima (9 crates): motor de documentos, DB, schema, API, auth y capa UI compartida. |
| [`FerrisFramework`](https://github.com/OpenFerris/FerrisFramework) | Fachada pública (12 crates): Desk, verticales, host WASM, servidor y CLI. |
| **`FerrisDocs`** | Este sitio. Solo necesita Node 24. |

## Requisitos

- **Docker + Docker Compose v2** (vía recomendada).
- **Node.js 24** solo si prefieres ejecutar el sitio directamente en el host.

## Ejecutar con Docker

`node_modules/` vive en un volumen con nombre, así que el host no acaba con un
árbol de dependencias propiedad de root. `dist/` sí se escribe en el checkout:

```bash
# Dependencias exactas del lockfile
docker compose run --rm docs sh -lc 'npm ci'

# Build de producción (genera dist/ y prefija los enlaces con /FerrisDocs)
docker compose run --rm docs sh -lc 'npm run build'

# Servidor de desarrollo en http://localhost:4321
docker compose run --rm docs sh -lc 'npm run dev -- --host 0.0.0.0'
```

## Ejecutar con Node local

```bash
npm ci
npm run dev       # http://localhost:4321
npm run check     # astro check
npm run build     # dist/
```

## Publicación

El workflow `.github/workflows/pages.yml` compila el sitio y lo publica con
GitHub Pages cuando `master` cambia. `develop` solo ejecuta la CI
(`ci.yml`). La URL pública es
<https://openferris.github.io/FerrisDocs/>; el `base` del proyecto es
`/FerrisDocs`.

## Ramas

- `develop` — integración y rama por defecto; todo PR va aquí.
- `master` — producción; solo merges de `release/*` y `hotfix/*`.

Las reglas completas están en [`AGENTS.md`](AGENTS.md).
