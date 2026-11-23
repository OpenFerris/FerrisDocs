---
title: Apps WASM
description: Qué es una app de Ferris, qué declara el componente, dónde vive en el host y qué superficie obtiene sin escribir Rust.
---

Una **app** de Ferris (también *plugin*) es un **componente WebAssembly** que
implementa el world `ferris-app`. El host lo carga, lo instancia en un sandbox y
le entrega exactamente los servicios que la app declaró. La app no enlaza el
framework, no abre sockets, no habla SQL y no lee certificados: pide, y el host
ejecuta en su nombre.

:::tip[No necesitas Rust]
El contrato es WIT, no un lenguaje. Puedes escribir la app en Python,
JavaScript/TypeScript, Go, C/C++, C#, Zig o cualquier toolchain que produzca un
componente del world `ferris-app`. Rust es una opción más, con su propia página
en [lenguajes](/apps/languages/).
:::

## El contrato en una frase

El paquete `ferris:framework@0.4.0` define seis interfaces de importación
(`types`, `data`, `schema`, `io`, `platform`, `descriptor`) y nueve funciones de
exportación. Todo lo que la app puede hacer entra por ahí, y todo lo que el host
le pide sale por ahí.

| Export | Cuándo lo llama el host |
|---|---|
| `describe` | al cargar la app, para conocer su superficie |
| `handle-request` | una petición HTTP de una ruta de la app |
| `doctype-event` | un evento del ciclo de vida de un DocType |
| `handle-stream` | un fragmento de un stream abierto |
| `handle-stream-event` | apertura, cierre o error de un stream |
| `handle-datagram` | un datagrama UDP, raw o ICMP con el peer que lo envió |
| `handle-job` | un trabajo en segundo plano |
| `ui-asset` | el Desk pide un asset de la app |
| `ui-widget` | el Desk pide el HTML SSR de un widget |

## Qué declara una app

`describe()` devuelve un `descriptor` tipado. No es un JSON que el host
interprete a ciegas: es el registro del contrato, así que un campo mal escrito no
compila en tu lenguaje. Con él la app declara:

| Sección | Efecto |
|---|---|
| `doctypes` | DocTypes, campos, índices y vistas del Desk |
| `routes` | endpoints HTTP que el host monta y te entrega |
| `methods` | handlers en `/api/method/<name>` |
| `workspaces`, `folders`, `themes` | navegación y paleta del Desk |
| `ui-extensions`, `dashboards`, `widgets`, `website` | superficie visual |
| `capabilities` | privilegios **específicos** que la app pide |
| `subscriptions` | canales de pubsub a los que publica |
| `config` | esquema de ajustes que el Desk renderiza |
| `assets` | ficheros que sirve `ui-asset` |
| `plugin-version`, `requires` | versión de la app y requisitos que declara |

El detalle, campo por campo, está en [descriptor y describe()](/apps/descriptor/).

## Dónde vive

En un bench, el **catálogo global** está en `apps/`: `ferris build` deja allí el
paquete (`<app>.wasm`, `plugin.toml`, `world/` y `assets/`) y `ferris site
install-app` lo copia a un sitio. El host lee los componentes de
`[apps] wasm_dir`, que en el bench es `"apps"`.

Un `--standalone` conserva el layout plano, y el host acepta las dos
disposiciones. La plana gana cuando existen las dos:

```text
plugins/
  mi-app.wasm          # componente suelto — tiene prioridad
  mi-app/
    mi-app.wasm        # el componente dentro de su propio mundo
    customizations/
    data/
    files/
    secrets/
```

El **nombre de la app** es el nombre del fichero sin `.wasm`. Se publica en
`/plugins/<app>`, da nombre a sus espacios de URL propios y a su mundo. Un nombre
con puntos, barras o espacios no es válido: no se sanea, se rechaza.

## Qué obtiene

Una app cargada consigue, sin configurar nada:

- **DocTypes** con lista y formulario en el Desk, y su API en
  `/api/resource/<doctype>`;
- **rutas** propias en la raíz, en el `path` que declare, más
  `/api/plugins/<app>/*` y `/desk/<app>/*`;
- **métodos** en `/api/method/<name>`;
- **ciclo de vida** sobre los DocTypes que declara;
- **un mundo** en disco, `<wasm_dir>/<app>/`, montado en `/world` con lectura y
  escritura;
- **capacidades** primordiales (rutas, HTTP saliente, document store, config,
  schema, scheduler, notificaciones, pubsub, mundo) y las específicas que
  declare;
- **widgets, dashboards, workspaces y páginas** dentro del Desk.

`/plugins/<app>/*` (el reenvío directo al guest) solo existe en `ferris dev`; en
producción se sirven el descriptor, los assets y los widgets. La entrada es la
ruta declarada o `/api/plugins/<app>/*`.

## El recorrido de una petición

```text
cliente
  │  GET /api/plugins/mi-app/informes/2026
  ▼
host ── resuelve la app ── aplica la política ── limita el cuerpo
  │
  └─ handle-request("api", { path: "/informes/2026", … })
        │
        └─ la app responde { status, headers, body }
```

El host no interpreta tus rutas: te entrega el `route-id` que resolvió y el
`path` que sigue al prefijo. Analizar el resto es tu trabajo. Si la ruta está
declarada en `describe().routes`, el `route-id` es el `id` de esa ruta y el host
la monta en la raíz, con su `auth` y su límite.

## Los assets son código de confianza

`ui-asset` devuelve bytes que el navegador ejecuta **en el mismo origen** que el
Desk. Ese JavaScript puede leer el DOM, usar la cookie de sesión y llamar a
`/api/*` como el usuario. El sandbox cubre los imports del componente, **no** el
JavaScript que la app pide ejecutar al navegador.

:::caution[Instalar una app es confiar en su UI]
Sirve scripts propios solo desde una app que controlas. El host lo advierte en el
log al arrancar y sirve los assets con el origen del Desk a propósito.
:::

## Mapa de esta sección

| Página | Qué resuelve |
|---|---|
| [Primeros pasos](/apps/getting-started/) | del WIT a un componente cargado |
| [El contrato WIT](/apps/wit/) | world, interfaces, tipos y compatibilidad |
| [descriptor](/apps/descriptor/) | qué declara `describe()`, campo por campo |
| [Capacidades](/apps/capacidades/) | primordiales, específicas y `permission-denied` |
| [Ciclo de vida](/apps/ciclo-de-vida/) | eventos, orden, abortos y `write-disposition` |
| [Mundo, rutas y métodos](/apps/mundo-y-rutas/) | `/world`, namespaces y cadena de métodos |
| [Documentos](/apps/data/) | leer, escribir, listar, contar y agregar |
| [UI extensions](/apps/ui-extensions/) | slots, widgets, dashboards y website |
| [Construir](/apps/building/) | comandos exactos por toolchain |
| [Distribuir](/apps/distribution/) | empaquetado, versión, actualización y rollback |
| [Lenguajes](/apps/languages/) | comparativa y guía por lenguaje |
| [Depuración](/apps/depuracion/) | logs, endpoints y checklist de aislamiento |
