// Ferris documentation site.
//
// Astro is the framework; Vite is its bundler/dev server (Astro embeds Vite
// directly, so the `vite` block below configures the same pipeline that serves
// `npm run dev` and builds `npm run build`). Starlight provides the docs shell:
// sidebar, search, dark mode, table of contents and accessibility.
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightVersions from 'starlight-versions';

const repo = 'https://github.com/OpenFerris/FerrisDocs';

// One source of truth for the facts the shell repeats. The docs repo is
// standalone: `project.json` is bumped by the release process together with
// FerrisCore/FerrisFramework (Cargo + WIT), so the site can be built in
// isolation without reading a sibling checkout.
const project = JSON.parse(readFileSync(new URL('./project.json', import.meta.url), 'utf8'));
const { version, crates, toolchain } = project;
if (!version || !crates || !toolchain) {
  throw new Error('docs-site: project.json needs version, crates and toolchain');
}

export default defineConfig({
  site: 'https://openferris.github.io',
  base: '/FerrisDocs',
  // No `site` is hardcoded: the public domain is decided when the site is
  // published. Set it there (for example in the deploy environment) so
  // canonical URLs and the sitemap use the real origin instead of a guess.
  integrations: [
    starlight({
      title: 'Ferris',
      description:
        'Framework web full-stack en Rust, dirigido por metadatos y con apps WASM.',
      logo: {
        src: './src/assets/logo.svg',
        alt: 'Ferris',
      },
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: {
        root: { label: 'Español', lang: 'es' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: {
        baseUrl: `${repo}/edit/master/src/content/docs/`,
      },
      customCss: ['./src/styles/custom.css'],
      plugins: [
        starlightVersions({
          // Archived copies live under /<slug>/ and stay frozen. The current
          // docs are the working copy, so the label says `dev`: a release
          // archives them and bumps Cargo.toml, never the other way around.
          current: { label: `v${version} (dev)` },
          versions: [{ slug: '0.2', label: 'v0.2.0' }],
        }),
      ],
      components: {
        Footer: './src/components/Footer.astro',
      },
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'alternate',
            type: 'text/markdown',
            href: '/llms.txt',
            title: 'Ferris documentation for LLMs',
          },
        },
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://fonts.gstatic.com',
            crossorigin: 'anonymous',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
          },
        },
      ],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
      pagination: true,
      lastUpdated: false,
      sidebar: [
        {
          label: 'Ferris (framework)',
          items: [
            {
              label: 'Primeros pasos',
              items: [
                { label: 'Resumen', link: '/getting-started/' },
                { label: 'Instalación', slug: 'getting-started/instalacion' },
                { label: 'Inicio rápido', slug: 'getting-started/inicio-rapido' },
                { label: 'Estructura del proyecto', slug: 'getting-started/estructura-proyecto' },
                { label: 'Tu primer DocType', slug: 'getting-started/primer-doctype' },
              ],
            },
            {
              label: 'Arquitectura',
              items: [
                { label: 'Visión general', link: '/arquitectura/' },
                { label: `Las ${crates} crates`, slug: 'arquitectura/crates' },
                { label: 'Módulos nativos', slug: 'arquitectura/modulos-nativos' },
                { label: 'Modelo de datos', slug: 'arquitectura/modelo-de-datos' },
                { label: 'Ciclo de vida', slug: 'arquitectura/ciclo-de-vida' },
                { label: 'Petición HTTP', slug: 'arquitectura/peticion-http' },
              ],
            },
            {
              label: 'Conceptos',
              items: [
                { label: 'Índice', link: '/conceptos/' },
                { label: 'DocTypes', slug: 'conceptos/doctypes' },
                { label: 'Campos y fieldtypes', slug: 'conceptos/campos-y-fieldtypes' },
                { label: 'DocStatus', slug: 'conceptos/docstatus' },
                { label: 'Naming', slug: 'conceptos/naming' },
                { label: 'Campos virtuales', slug: 'conceptos/campos-virtuales' },
                { label: 'DocTypes virtuales', slug: 'conceptos/doctypes-virtuales' },
                { label: 'Controladores y hooks', slug: 'conceptos/controladores' },
                { label: 'Permisos', slug: 'conceptos/permisos' },
                { label: 'Actions, Links y Customize', slug: 'conceptos/actions-links-customize' },
                { label: 'Workflows', slug: 'conceptos/workflows' },
              ],
            },
            {
              label: 'Guías',
              items: [
                { label: 'Índice', link: '/guias/' },
                { label: 'Formularios', slug: 'guias/formularios' },
                { label: 'Listas y vistas', slug: 'guias/listas-y-vistas' },
                { label: 'Dashboards', slug: 'guias/dashboards' },
                { label: 'Widgets', slug: 'guias/widgets' },
                { label: 'Trabajos y scheduler', slug: 'guias/trabajos-y-scheduler' },
                { label: 'Realtime', slug: 'guias/realtime' },
                { label: 'Archivos', slug: 'guias/archivos' },
                { label: 'Email', slug: 'guias/email' },
                { label: 'Informes e impresión', slug: 'guias/informes-e-impresion' },
                { label: 'Integraciones', slug: 'guias/integraciones' },
                { label: 'Multi-tenant', slug: 'guias/multi-tenant' },
                { label: 'Temas y UI', slug: 'guias/temas-y-ui' },
              ],
            },
            {
              label: 'CLI',
              items: [
                { label: 'Referencia de comandos', link: '/cli/' },
                { label: 'ferris init y contexto', slug: 'cli/init-y-contexto' },
                { label: 'ferris new', slug: 'cli/new' },
                { label: 'ferris dev', slug: 'cli/dev' },
                { label: 'ferris serve y run', slug: 'cli/serve-y-run' },
                { label: 'ferris build y deploy', slug: 'cli/build-y-deploy' },
                { label: 'ferris app', slug: 'cli/app' },
                { label: 'ferris migrate', slug: 'cli/migrate' },
                { label: 'ferris generate', slug: 'cli/generate' },
                { label: 'ferris tenant', slug: 'cli/tenant' },
                { label: 'ferris shell y benchmark', slug: 'cli/shell-benchmark' },
                { label: 'ferris info, doctor y config', slug: 'cli/info-doctor-config' },
                { label: 'ferris role-permissions', slug: 'cli/role-permissions' },
              ],
            },
            {
              label: 'Configuración',
              items: [
                { label: 'config/ferris.toml', link: '/configuracion/' },
                { label: 'Servidor', slug: 'configuracion/servidor' },
                { label: 'Base de datos', slug: 'configuracion/base-de-datos' },
                { label: 'Autenticación', slug: 'configuracion/autenticacion' },
                { label: 'Features de compilación', slug: 'configuracion/features' },
                { label: 'Servicios', slug: 'configuracion/servicios' },
                { label: 'Secretos', slug: 'configuracion/secretos' },
                { label: 'Apps', slug: 'configuracion/apps' },
                { label: 'Sitios', slug: 'configuracion/sites' },
                { label: 'i18n y locales', slug: 'configuracion/i18n' },
              ],
            },
            {
              label: 'API HTTP',
              items: [
                { label: 'Índice', link: '/api/' },
                { label: 'Autenticación', slug: 'api/autenticacion' },
                { label: 'Recursos', slug: 'api/recursos' },
                { label: 'Metadatos y doctypes', slug: 'api/metadatos' },
                { label: 'Métodos, JSON-RPC y Batch', slug: 'api/metodos-rpc-graphql' },
                { label: 'Errores y permisos', slug: 'api/errores-y-permisos' },
                { label: 'OpenAPI', slug: 'api/openapi' },
              ],
            },
            {
              label: 'Desk (frontend)',
              items: [
                { label: 'Índice', link: '/frontend/' },
                { label: 'El Desk', slug: 'frontend/desk' },
                { label: 'Biblioteca de componentes', slug: 'frontend/componentes-ui' },
                { label: 'Formularios', slug: 'frontend/formularios' },
                { label: 'API del Desk', slug: 'frontend/api-desk' },
                { label: 'Listas y tablas', slug: 'frontend/listas' },
                { label: 'Dashboards y widgets', slug: 'frontend/dashboards-y-widgets' },
                { label: 'Theming', slug: 'frontend/theming' },
                { label: 'SSR e hidratación', slug: 'frontend/ssr-hidratacion' },
              ],
            },
            {
              label: 'Operaciones',
              items: [
                { label: 'Índice', link: '/operaciones/' },
                { label: 'Despliegue', slug: 'operaciones/despliegue' },
                { label: 'Producción', slug: 'operaciones/produccion' },
                { label: 'Seguridad', slug: 'operaciones/seguridad' },
                { label: 'Observabilidad', slug: 'operaciones/observabilidad' },
                { label: 'Backup y migraciones', slug: 'operaciones/backup-y-migraciones' },
              ],
            },
            {
              label: 'Referencia',
              items: [
                { label: 'Índice', link: '/referencia/' },
                { label: 'DocTypes incluidos', slug: 'referencia/doctypes-incluidos' },
                { label: 'Fieldtypes', slug: 'referencia/fieldtypes' },
                { label: 'Paridad con Frappe', slug: 'referencia/paridad-frappe' },
                { label: 'Errores', slug: 'referencia/errores' },
                { label: 'Features del host', slug: 'referencia/host-features' },
                { label: 'Variables de entorno', slug: 'referencia/variables-entorno' },
                { label: 'Versionado y compatibilidad', slug: 'referencia/versionado' },
                { label: 'Documentación para LLMs', slug: 'referencia/llms' },
                { label: 'Glosario', slug: 'referencia/glosario' },
              ],
            },
            {
              label: 'Contribuir',
              items: [
                { label: 'Índice', link: '/contribuir/' },
                { label: 'Entorno de desarrollo', slug: 'contribuir/entorno' },
                { label: 'Estilo de código', slug: 'contribuir/estilo' },
                { label: 'Pruebas', slug: 'contribuir/pruebas' },
                { label: 'Documentación', slug: 'contribuir/documentacion' },
              ],
            },
          ],
        },
        {
          label: 'Apps WASM',
          items: [
            { label: 'Visión general', link: '/apps/' },
            { label: 'Primeros pasos', slug: 'apps/getting-started' },
            { label: 'El contrato WIT', slug: 'apps/wit' },
            { label: 'descriptor y describe()', slug: 'apps/descriptor' },
            { label: 'Capacidades', slug: 'apps/capacidades' },
            { label: 'Ciclo de vida', slug: 'apps/ciclo-de-vida' },
            { label: 'Mundo, rutas y métodos', slug: 'apps/mundo-y-rutas' },
            { label: 'Datos y API', slug: 'apps/data' },
            { label: 'UI extensions', slug: 'apps/ui-extensions' },
            { label: 'Construir el componente', slug: 'apps/building' },
            {
              label: 'Lenguajes',
              items: [
                { label: 'Comparativa', link: '/apps/languages/' },
                { label: 'Rust', slug: 'apps/languages/rust' },
                { label: 'Python', slug: 'apps/languages/python' },
                { label: 'JavaScript y TypeScript', slug: 'apps/languages/javascript' },
                { label: 'Go', slug: 'apps/languages/go' },
                { label: 'C, C++, C# y otros', slug: 'apps/languages/other' },
              ],
            },
            { label: 'Depuración', slug: 'apps/depuracion' },
            { label: 'Distribución', slug: 'apps/distribution' },
          ],
        },
      ],
    }),
  ],
  // Astro's dev server and build are Vite underneath. Keeping the block here
  // documents that the pipeline is Vite and gives one place to tune it.
  vite: {
    define: {
      __FERRIS_VERSION__: JSON.stringify(version),
      __FERRIS_CRATES__: JSON.stringify(crates),
      __FERRIS_TOOLCHAIN__: JSON.stringify(toolchain),
    },
    build: {
      target: 'es2022',
    },
    server: {
      // Fail loudly when the port is taken instead of silently moving to
      // 4322/4323 and leaving the browser pointed at a stale server. A stale
      // server is what turns `/@vite/client` into `text/html` (a 404/fallback
      // page) and the browser then blocks the module by MIME type.
      port: 4321,
      strictPort: true,
    },
  },
});
