---
title: Guías
description: Recetas prácticas de Ferris 0.4.0 — presentación, trabajos, realtime, archivos, email, informes, integraciones y multi-tenant.
---

Cada guía resuelve un problema concreto con el código y la configuración reales de
Ferris `0.4.0`. No son tutoriales de Rust: suponen que sabes leer un `Cargo.toml`
y que el proyecto ya arranca. Ferris tiene 21 crates repartidos en dos
workspaces y se compila con Rust `1.98.1`; el contrato de plugins es
`ferris:framework@0.4.0`.

## Desk y presentación

| Guía | Cuándo abrirla |
|---|---|
| [Formularios](/guias/formularios/) | campos, controles, validaciones y acciones |
| [Listas y vistas](/guias/listas-y-vistas/) | columnas, filtros y acciones masivas |
| [Dashboards](/guias/dashboards/) | declarar, sembrar y estilar un tablero |
| [Widgets](/guias/widgets/) | definición, parámetros y montaje |
| [Temas y UI](/guias/temas-y-ui/) | tokens, CSS de plugin y contraste |

## Apps y extensión

El ciclo completo de una app WASM vive en su propio portal:
[plugins y apps WASM](/apps/). Allí están el scaffold, el CRUD, el contrato WIT y
el mundo de la app.

| Guía | Cuándo abrirla |
|---|---|
| [UI extensions](/apps/ui-extensions/) | añadir botones, widgets o páginas al Desk |
| [Mundo, rutas y métodos](/apps/mundo-y-rutas/) | `/world`, namespaces y overrides |

## Procesamiento en segundo plano

| Guía | Cuándo abrirla |
|---|---|
| [Trabajos y scheduler](/guias/trabajos-y-scheduler/) | cron, colas Redis, reintentos y DLQ |
| [Realtime](/guias/realtime/) | WebSocket, eventos y pubsub |
| [Email](/guias/email/) | cuentas SMTP, plantillas y cola de envío |

## Datos y salida

| Guía | Cuándo abrirla |
|---|---|
| [Archivos](/guias/archivos/) | subidas, backends y el mundo del plugin |
| [Informes e impresión](/guias/informes-e-impresion/) | Query Reports y PDF/SVG/PNG/HTML |
| [Integraciones](/guias/integraciones/) | OAuth, Google, LDAP y webhooks |

## Infraestructura

| Guía | Cuándo abrirla |
|---|---|
| [Multi-tenant](/guias/multi-tenant/) | varios sitios en una instalación |

## Antes de empezar

Tres preguntas que afectan a casi todas las guías:

1. **¿Qué rol sirve esto?** `api`, `web`, `realtime`, `worker`, `scheduler`. Un
   binario sin el rol no arranca el subsistema, y un config que lo pide falla en
   el arranque con el nombre del feature que hay que compilar.
2. **¿Compilación o configuración?** Un Cargo feature decide si el código existe;
   `[features]` en `ferris.toml` decide si el rol se enciende. No son
   intercambiables.
3. **¿Dónde vive el dato?** El document store es para datos con DocType y
   permisos; `/world` es para lo que la app posee; el servicio de ficheros es para
   adjuntos y blobs del Desk. Elegir mal obliga a duplicar permisos.

:::note[Todo se ejecuta en el dev container]
`cargo`, `ferris`, `npm` y `tailwindcss` corren dentro del contenedor de
desarrollo (`docker compose run --rm ferris …`). Los ejemplos de shell de estas
guías suponen que ya estás ahí.
:::

## Convenciones de las guías

- Las rutas y campos reales van en `backticks`, igual que los tipos WIT.
- Los ejemplos de guest usan los módulos generados
  (`ferris::framework::{data, io, platform, descriptor, types}`).
- Los ejemplos de configuración son fragmentos de `config/ferris.toml`.
- Cuando algo no está implementado, la guía lo dice y muestra la respuesta real
  (por ejemplo, el `501` de `/api/report/{name}/prepare`).

## Errores de base que conviene conocer

| Síntoma | Causa habitual |
|---|---|
| 403 con un nombre entre paréntesis | falta esa capacidad específica |
| 404 en una ruta recién añadida | hay que reiniciar para montarla |
| 422 al escribir desde un hook | `before-*` no puede reentrar; usa `silent` |
| 501 | la función no existe, y el contrato lo dice |
| `unsupported: …` | el host no compiló ese vertical |

El resto, en [depuración](/apps/depuracion/).
