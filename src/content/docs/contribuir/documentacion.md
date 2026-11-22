---
title: Documentación
description: Cómo añadir una página al sitio de Ferris, frontmatter, navegación, enlaces y reglas editoriales.
---

El sitio es el repositorio **`FerrisDocs`**, independiente de los dos
workspaces de Rust, y usa **Astro + Starlight**. Astro aporta el framework y
Vite el bundler; Starlight pone el shell: navegación lateral, búsqueda, modo
oscuro, tabla de contenidos y accesibilidad.

El sitio tiene **dos portales**:

- **Ferris** — arquitectura, DocTypes, Desk, CLI, API, configuración y
  operaciones.
- **Apps WASM** (`/apps/**`) — el contrato WIT, el descriptor, las capacidades,
  el ciclo de vida y guías por lenguaje. Es deliberadamente **agnóstico**: una
  página de apps no exige Rust, no cita crates ni traits internos y no enlaza a
  la arquitectura del framework. Rust es una opción más en
  `/apps/languages/rust/`.

No mezcles ambos: si una página de app necesita explicar el motor de documentos
para entenderse, probablemente pertenece al portal de Ferris y debe enlazarse
desde allí.

```text
FerrisDocs/
├── astro.config.mjs          # Starlight, sidebar, versión y plugins
├── project.json              # versión, crates y toolchain que publica el sitio
├── package.json
├── scripts/prefix-base.mjs   # prefija los enlaces con /FerrisDocs en la build
├── src/
│   ├── content.config.ts     # colecciones `docs` y `versions`
│   ├── content/docs/         # las páginas de la versión actual
│   ├── content/docs/<slug>/  # copias archivadas (0.2/)
│   ├── content/versions/     # sidebar congelado de cada archivo
│   ├── components/
│   │   ├── Footer.astro              # footer del sitio tras el de Starlight
│   │   └── landing/HeroMeta.astro    # píldoras con los datos del proyecto
│   ├── data/footer.ts        # enlaces del footer, separados del marcado
│   ├── pages/                # llms.txt, llms-full.txt y los .md
│   ├── styles/               # tema dividido por responsabilidad
│   │   ├── custom.css        # entrada: importa las capas en orden
│   │   ├── tokens.css        # tokens y overrides de Starlight
│   │   ├── base.css          # tipografía, foco, enlaces, scrollbars
│   │   ├── shell.css         # cabecera, búsqueda, sidebar, TOC, paginación
│   │   ├── content.css       # prosa: código, tablas, asides, tarjetas
│   │   ├── landing.css       # plantilla splash y hero
│   │   └── footer.css        # `.ferris-footer`
│   └── assets/logo.svg
└── public/favicon.svg
```

## Añadir una página

1. Crea el fichero `.md` (o `.mdx`) en `src/content/docs/`, en la carpeta que le
   corresponda.
2. Escribe el frontmatter obligatorio: `title` y `description`.
3. Añade la entrada al `sidebar` de `astro.config.mjs`.
4. Enlaza la página desde al menos otra página del mismo bloque.
5. Comprueba que los enlaces internos resuelven.

```markdown
---
title: Mi página
description: Una frase que explica para qué sirve y qué aprende el lector.
---

Contenido en español. Los identificadores, rutas, claves TOML y tipos van en
`backticks` y en su forma real.
```

### Slugs

Starlight deriva el slug de la ruta del fichero:

| Fichero | Slug |
|---|---|
| `src/content/docs/configuracion/index.md` | `configuracion` |
| `src/content/docs/configuracion/servidor.md` | `configuracion/servidor` |
| `src/content/docs/operaciones/index.md` | `operaciones` |

Un `index.md` dentro de una carpeta es la portada de ese bloque, no una página
hija más.

## Navegación

El sidebar **no se autogenera**. En `astro.config.mjs`:

```js
{
  label: 'Operaciones',
  items: [
    { label: 'Índice', slug: 'operaciones' },
    { label: 'Despliegue', slug: 'operaciones/despliegue' },
    { label: 'Producción', slug: 'operaciones/produccion' },
  ],
}
```

Reglas:

- Un bloque nuevo necesita su propio objeto con `label` e `items`.
- La portada va primera, con `label: 'Índice'`.
- El `slug` no lleva barra inicial ni extensión.
- No dejes una página fuera del sidebar: una página huérfana no tiene contexto
  ni orden editorial.
- **Los `index.md` de sección se enlazan con `link`, no con `slug`.** Astro 7
  conserva el id `seccion/index` para un index anidado, mientras que Starlight
  solo normaliza el `index` de la raíz de la colección; un `slug: 'seccion'`
  falla con «specified in the Starlight sidebar config does not exist». La forma
  estable es `{ label: 'Índice', link: '/seccion/' }`, que además produce el
  mismo href que el lector espera.

## Versiones

La versión se declara en los dos `Cargo.toml`
(`[workspace.package]`) y en el paquete WIT, y el release la copia a
`project.json`; `astro.config.mjs` lee ese fichero y la inyecta como
`__FERRIS_VERSION__`, así que el sitio no repite el número y se construye sin
un checkout de Rust al lado. El mismo bloque inyecta `__FERRIS_CRATES__` y
`__FERRIS_TOOLCHAIN__`, que alimentan las píldoras del hero. El test
`FerrisFramework/ferris-wasm/tests/wit_version.rs` falla si Cargo y `ferris.wit`
no coinciden o si las dos copias del WIT difieren.

`starlight-versions` archiva el contenido en `src/content/docs/<slug>/` cuando
añades la versión a `plugins` en `astro.config.mjs`. La copia actual se edita;
la archivada es un snapshot de la versión publicada. La política completa está
en [Versionado](/referencia/versionado/).

## Contenido para LLMs

El sitio genera, en el build:

| Ruta | Contenido |
|---|---|
| `/llms.txt` | índice con título, descripción y enlace `.md` de cada página |
| `/llms-full.txt` | todas las páginas concatenadas |
| `/<slug>.md` | Markdown crudo de una página |

Los tres se generan desde la colección de contenido, así que una página nueva
aparece automáticamente. No hay una lista que mantener. El índice y el corpus
completo excluyen las copias archivadas (`0.2/`): un agente lee siempre la
versión actual. El Markdown debe ser autocontenido: un agente no ejecuta
componentes de UI ni resuelve HTML.

## Enlaces

- Internos: ruta absoluta y **con barra final**, por ejemplo
  `[Servidor](/configuracion/servidor/)`. Sin la barra, Starlight puede resolver
  una ruta distinta según el `trailingSlash` del despliegue.
- Externos: URL completa y estable; evita enlazar a un `localhost`.
- A otra página del sitio: enlaza por slug, no por ruta de fichero.
- A código: ruta desde la raíz del repo (`ferris-cli/src/config/load.rs`), no un
  enlace a un editor.

## Componentes y estilos

El shell es de Starlight; el sitio solo lo rebrandea. Antes de escribir marcado,
usa un componente de `@astrojs/starlight/components` (`Card`, `LinkCard`,
`Aside`, `Tabs`, `Steps`, `FileTree`, `Badge`) o una clase existente. Un
componente nuevo vive en `src/components/` y una capa nueva de CSS, en
`src/styles/`.

| Fichero | Qué cubre |
|---|---|
| `tokens.css` | colores, radios, sombras y overrides `--sl-color-*` |
| `base.css` | tipografía, `::selection`, foco visible y scrollbars |
| `shell.css` | cabecera, búsqueda, sidebar, tabla de contenidos y paginación |
| `content.css` | prosa: código, tablas, asides, `details`, tarjetas |
| `landing.css` | plantilla `splash`, hero y píldoras de datos |
| `footer.css` | `.ferris-footer` |

Reglas de clases:

- `ferris-<bloque>` para un componente suelto (`ferris-footer`).
- `ferris-<bloque>__<elemento>` para sus partes (`ferris-footer__inner`).
- `ferris-<bloque>--<modificador>` para variantes.
- Los ganchos de Starlight (`sl-*`, `starlight-*`, `sidebar-content`,
  `pagination-links`, `starlight-toc`) no se renombran: son el contrato que
  `shell.css` y `content.css` ajustan.
- Un color se escribe siempre como token (`var(--sl-color-*)` o
  `var(--ferris-*)`), nunca como hex en el punto de uso.
- Las superficies y bordes derivados del acento se declaran una vez en
  `tokens.css` (`--ferris-surface-subtle|hover|active`,
  `--ferris-border-accent|hover`, `--ferris-focus-ring`); no repitas
  `color-mix` con porcentajes sueltos en cada componente.
- El CSS propio queda sin `@layer`: gana a las capas globales de Starlight sin
  `!important`. Algunos estilos de componente se emiten sin capa; si pisan la
  misma propiedad, sube la especificidad con un atributo estable (`[href]`,
  `[aria-label]`), nunca con `!important`.
- No añadas una regla que solo repite un valor por defecto de Starlight. Una
  regla propia debe cambiar la superficie, el estado o el ritmo.
- Los datos del hero y del footer salen de `project.json` y
  `src/data/footer.ts`; no se duplican en el marcado.
- El CSS se organiza como CSS puro + tokens. No hay Tailwind en el sitio.

## Typecheck

`tsconfig.json` no extiende `astro/tsconfigs/strict`: replica sus opciones
(`strict`, `moduleResolution: Bundler`, `noEmit`, etc.) para que el editor y
`astro check` funcionen aunque `node_modules/` no esté instalado. Las
dependencias de comprobación (`@astrojs/check`, `typescript`) están en
`devDependencies`.

```bash
npm ci
npm run check     # 0 errores, 0 warnings, 0 hints
```

## Admoniciones

Starlight renderiza los bloques `:::`:

```markdown
:::note
Información que complementa el texto.
:::

:::tip
Una práctica recomendada.
:::

:::caution
Algo que puede salir mal si se ignora.
:::

:::danger
Riesgo de pérdida de datos o de seguridad.
:::
```

Un `danger` para "esto borra la clave y no se puede recuperar", no para
cualquier cosa que dé miedo. Si todo es urgente, nada lo es.

## Bloques de código

- Etiqueta el lenguaje: ` ```toml `, ` ```bash `, ` ```rust `, ` ```text `.
- Un ejemplo de configuración debe ser **copiable**: claves reales, valores
  válidos, sin `...` en medio de una tabla.
- Un ejemplo de shell debe indicar el directorio o el contexto si importa.
- No inventes flags ni claves. Si no existe en el código, no va en la página.

## Comandos del sitio

El sitio no necesita el workspace de Rust: basta con Node 24. Si trabajas
dentro del contenedor de `FerrisFramework`, ejecuta los comandos con Node del
host o publica el repositorio hermano en el contenedor; `FerrisDocs` no tiene
`Dockerfile` propio.

```bash
cd FerrisDocs
npm ci            # instala exactamente package-lock.json
npm run dev       # servidor de desarrollo; imprime la URL real
npm run build     # genera el sitio estático en dist/ y prefija /FerrisDocs
npm run preview   # sirve dist/ para comprobar la build
npm run check     # valida tipos y contenido
```

Astro 7 puede dejar el servidor en segundo plano. Si el navegador carga un
puerto antiguo, `/@vite/client` lo sirve otro proceso con `text/html` y el
navegador lo bloquea por MIME type:

```bash
npm run dev:status   # puerto y PID reales
npm run dev:logs
npm run dev:stop     # detiene el daemon anterior
npm run dev:bg -- --port 4321
```

Abre siempre la URL que imprime el comando; no fijes `4322` a mano.

No borres `node_modules/` mientras el daemon está arrancado: Vite conserva rutas
abiertas y la siguiente petición falla con `ENOENT` sobre
`@astrojs/starlight/dist/routes/...`. Para reinstalar: `npm run dev:stop`,
`npm ci` y arranca de nuevo.

Node 22.23 o superior (lo exige Astro 7); el dev container trae Node 24.

## Reglas editoriales

0. **Sistema actual, no historia.** Explica cómo funciona hoy. Nada de
   “antes se hacía”, “se retiró”, IDs de auditoría, bugs pasados ni tablas de
   versiones. Si algo es un límite actual, descríbelo como límite, no como deuda.
1. **Español claro.** Frases cortas, voz activa, sin jerga innecesaria.
2. **Identificadores reales en `backticks`**: `[server]`, `enable_cors`,
   `jwt_expiry_hours`, `ferris migrate`.
3. **Sin promesas futuras.** Si algo no está implementado, se dice "no está
   implementado" o "hoy no se cablea". No "próximamente".
4. **Sin APIs inventadas.** Cada endpoint, flag o campo debe existir en el
   código. Ante la duda, grep y lectura antes de escribirlo.
5. **Nada de builds ni tests ejecutados en el host.** Las páginas de operaciones
   pueden describir comandos; la documentación no los ejecuta por ti.
6. **Datos verificables.** Versión del workspace (la de los dos `Cargo.toml` y
   `project.json`), Rust `1.98.1`, el mismo número en el paquete WIT y 21
   crates. Si un dato cambia, se actualiza en todas las páginas que lo citan; el
   sitio lo lee de `project.json` (o de `__FERRIS_VERSION__` en un componente),
   nunca se duplica a mano.
7. **80–220 líneas por página.** Una página que necesita 400 es dos páginas o
   una poda.
8. **Enlaces con barra final.** Un enlace roto es un fallo de la página.

## Actualizar la documentación con el código

Un cambio que altera una interfaz pública debe actualizar su página en el
**mismo PR**:

| Cambio | Página |
|---|---|
| Clave o sección de `ferris.toml` | `configuracion/*` |
| Flag o subcomando del CLI | `cli/*` |
| Ruta o contrato de la API | `api/*` |
| Componente o comportamiento del Desk | `frontend/*` |
| Contrato WIT o capacidad | `apps/*` |
| Feature de Cargo | `configuracion/features` y `referencia/host-features` |

## Antes de publicar

- [ ] Frontmatter con `title` y `description`.
- [ ] Página en el sidebar, en el bloque correcto.
- [ ] Enlaces internos absolutos y con barra final.
- [ ] Ejemplos TOML/bash copiables y con claves reales.
- [ ] Sin afirmaciones sin verificar; las limitaciones, explícitas.
- [ ] `npm run build` sin enlaces rotos.

## Dónde encaja cada tema

Cada bloque del sitio tiene un propósito: primeros pasos, arquitectura,
conceptos, guías, CLI, configuración, API, Desk, plugins, referencia,
operaciones y contribuir. Si una página no encaja en ninguno, probablemente sean
dos páginas.
