# Documentación de Ferris

Sitio de documentación oficial del framework **Ferris**, construido con
[Astro](https://astro.build) y [Starlight](https://starlight.astro.build). Astro
usa Vite como bundler y servidor de desarrollo, así que el pipeline es el mismo
para `dev` y `build`.

## Requisitos

- **Docker + Docker Compose v2** (vía recomendada). La imagen de desarrollo ya
  trae Node 24 y las dependencias del sitio se instalan dentro del contenedor.
- **Node.js 22.23 o superior** solo si prefieres ejecutar el sitio directamente
  en el host. No es necesario para el resto de Ferris.

El sitio no es un miembro del workspace de Cargo: vive en `docs-site/` con su
propio `package.json` y su propio `package-lock.json`.

## Ejecutar con Docker

El servicio `ferris` de `compose.yaml` monta el repositorio en `/workspace`.
Instala las dependencias una vez (quedan en `docs-site/node_modules`, visible en
el host) y arranca el servidor publicando el puerto:

```bash
# Dependencias exactas del lockfile
docker compose run --rm -p 4321:4321 ferris \
  bash -lc 'cd docs-site && npm ci'

# Servidor de desarrollo
docker compose run --rm -p 4321:4321 ferris \
  bash -lc 'cd docs-site && npm run dev -- --host 0.0.0.0'
```

Abre `http://localhost:4321`. `--host 0.0.0.0` es necesario para que el servidor
escuche fuera del contenedor; con el valor por defecto solo aceptaría conexiones
de dentro.

`-p 4321:4321` publica el puerto en un contenedor efímero. También puedes usar
`--service-ports`, que aplica todos los mapeos del servicio (`8000` y `4321`):

```bash
docker compose run --rm --service-ports ferris \
  bash -lc 'cd docs-site && npm run dev -- --host 0.0.0.0'
```

Si ya tienes un contenedor de desarrollo levantado, entra en él y ejecuta los
comandos sin prefijo:

```bash
docker compose up -d ferris
docker compose exec ferris bash -lc 'cd docs-site && npm run dev -- --host 0.0.0.0'
```

La primera instalación necesita red para descargar los paquetes; después,
`node_modules` se reutiliza entre ejecuciones porque está en el bind mount.

## Ejecutar con Node local

Con Node 22.23 o superior:

```bash
cd docs-site
npm ci            # instala exactamente package-lock.json
npm run dev       # servidor de desarrollo; imprime la URL real
npm run build     # genera el sitio estático en dist/
npm run preview   # sirve dist/ para comprobar la build
npm run check     # valida tipos y contenido con astro check
```

Usa `npm install` solo cuando cambies `package.json`; el resto del tiempo, `npm
ci` mantiene la instalación idéntica al lockfile.

## Salida para LLMs

El build genera tres vistas además del HTML:

| Ruta | Contenido |
|---|---|
| `/llms.txt` | índice con título, descripción y enlace `.md` de cada página |
| `/llms-full.txt` | todas las páginas concatenadas |
| `/<slug>.md` | Markdown crudo de una página (`/apps/wit.md`, `/conceptos/naming.md`) |

Se generan desde la colección de contenido, así que no hay una lista que
mantener. El detalle está en
[`src/content/docs/referencia/llms.md`](src/content/docs/referencia/llms.md).

## Versiones de la documentación

La documentación **actual** vive en `src/content/docs/` y es la que se edita.
Cada versión publicada se archiva con
[`starlight-versions`](https://starlight-versions.vercel.app) en
`src/content/docs/<slug>/` (hoy `0.2/`) y guarda la metadata de su sidebar en
`src/content/versions/<slug>.json`. El selector de la cabecera cambia entre la
copia actual —etiquetada `v<versión> (dev)`— y las archivadas.

Para publicar una versión:

1. Sube la versión en `Cargo.toml` y en las dos copias de
   `ferris-wasm/wit/ferris.wit` / `test/wit/ferris.wit` a la vez.
2. Añade la versión nueva a `plugins[0].versions` en `astro.config.mjs`
   (`{ slug: '0.4', label: 'v0.4.0' }` cuando se archive la actual `0.3`).
3. Arranca `npm run dev` o `npm run build`: el plugin copia el contenido actual
   a `src/content/docs/0.4/` y escribe `src/content/versions/0.4.json`.
4. Revisa el diff, commitea la copia archivada y no la edites después: es un
   snapshot.

La copia actual sí se edita con normalidad. Los endpoints `/llms.txt` y
`/llms-full.txt` excluyen las copias archivadas para que un agente lea siempre
la versión actual.

## Servidor en segundo plano (Astro 7)

Astro 7 puede mantener el dev server en segundo plano con un daemon:

```bash
npm run dev:bg -- --port 4321   # arranca en background
npm run dev:status              # ¿hay uno corriendo y en qué puerto?
npm run dev:logs                # log del servidor en background
npm run dev:stop                # lo detiene
```

Esto está pensado para una máquina o una shell persistente. Dentro de un
contenedor efímero (`docker compose run --rm`), el daemon muere cuando termina el
comando que lo lanzó; para usar el modo background, levanta el servicio con
`docker compose up -d ferris` y trabaja con `docker compose exec`.

> **No reutilices un puerto a ciegas.** `astro.config.mjs` fija
> `server.port = 4321` y `strictPort: true`: si el puerto está ocupado, el
> arranque falla en lugar de moverse a `4322` en silencio. Si el navegador carga
> una página de un puerto antiguo, `/@vite/client` lo responde otro proceso (a
> menudo con `text/html`) y el navegador lo bloquea por MIME type. Para el
> daemon anterior con `npm run dev:stop` y vuelve a arrancar; no asumas que el
> puerto cambió.

> **No borres `node_modules` con el servidor arrancado.** Astro mantiene el
> daemon y Vite con rutas abiertas dentro de `node_modules`. Si borras esa
> carpeta mientras corre, la siguiente petición falla con `ENOENT` sobre
> `@astrojs/starlight/dist/routes/static/index.astro`. Para reinstalar:
> `npm run dev:stop`, `npm ci` y arranca de nuevo.

## Estructura

```text
docs-site/
├── astro.config.mjs        # integración de Starlight + navegación lateral
├── package.json            # scripts y dependencias del sitio
├── package-lock.json       # versiones fijadas (se commitea)
├── tsconfig.json           # configuración TypeScript autocontenida
├── src/
│   ├── content.config.ts   # colección de contenido (Starlight)
│   ├── content/docs/       # las páginas, en Markdown/MDX
│   ├── content/versions/   # sidebar congelado de cada versión archivada
│   ├── components/
│   │   ├── Footer.astro            # footer del sitio tras el de Starlight
│   │   └── landing/HeroMeta.astro  # píldoras de datos del hero
│   ├── data/footer.ts      # enlaces del footer (datos, no marcado)
│   ├── styles/
│   │   ├── custom.css      # entrada: importa las capas en orden
│   │   ├── tokens.css      # tokens y overrides del tema de Starlight
│   │   ├── base.css        # tipografía, foco, enlaces y scrollbars
│   │   ├── shell.css       # cabecera, búsqueda, sidebar, TOC, paginación
│   │   ├── content.css     # prosa: código, tablas, asides, tarjetas
│   │   ├── landing.css     # plantilla splash y píldoras del hero
│   │   └── footer.css      # `.ferris-footer`
│   └── assets/logo.svg
└── public/favicon.svg
```

`tsconfig.json` es autocontenido a propósito: no hace `extends` del preset de
Astro, así que un editor o `astro check` no falla con «Tsconfig not found» cuando
`node_modules/` no está instalado. `@astrojs/check` y `typescript` viven en
`devDependencies` y se instalan con el lockfile.

## Escribir una página

Cada página declara, como mínimo:

```md
---
title: Título de la página
description: Una frase que explica para qué sirve.
---

Contenido en español. Los identificadores, rutas, claves TOML y tipos van en
`backticks` y en su forma real.
```

La navegación no se autogenera: al añadir una página hay que enlazarla en el
`sidebar` de `astro.config.mjs`. Esto evita que una página huérfana aparezca sin
contexto y mantiene el orden editorial. Al renombrar o borrar una página,
actualiza todos los enlaces entrantes.

## Reglas de contenido

- Español claro; los identificadores, rutas y tipos se escriben en su forma real
  (en inglés) dentro de `backticks`.
- Nada de APIs inventadas: cada endpoint, comando o campo debe existir en el
  código. Si algo es una limitación, se dice explícitamente.
- Enlaces internos con ruta absoluta y barra final (`/getting-started/instalacion/`).
- Un ejemplo mínimo y ejecutable vale más que tres párrafos de introducción.
- La versión del framework es `0.3.0` (pre-1.0), el toolchain `1.98.1` y el
  contrato WIT `ferris:framework@0.3.0`; Cargo y WIT comparten la misma cifra y
  la política está en [Versionado](src/content/docs/referencia/versionado.md).
- Los comandos del repositorio se ejecutan dentro de Docker
  (`docker compose run --rm ferris …`), no en el host.

## Qué se commitea

Se versionan `package.json`, `package-lock.json`, `astro.config.mjs`,
`tsconfig.json` y todas las páginas. `node_modules/`, `dist/` y `.astro/` están
en `docs-site/.gitignore` y no deben aparecer en un diff.

Antes de abrir un PR que toque el sitio:

```bash
docker compose run --rm ferris bash -lc 'cd docs-site && npm run build'
docker compose run --rm ferris bash -lc 'cd docs-site && npm run check'
```
