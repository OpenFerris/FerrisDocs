---
title: Apps
description: Componentes WASM, descubrimiento en plugins/, mundo de la app y
  customizaciones aplicadas en migrate.
slug: 0.2/configuracion/apps
---

Una **app** de Ferris es un componente WebAssembly que declara DocTypes, rutas,
widgets, dashboards y métodos desde `describe()`. Implementa el contrato
`ferris:framework@0.2.0` (ver [El contrato WIT](/0.2/apps/wit/)). El servidor lo
descubre en disco, lo publica y lo aísla en su propio directorio, llamado
**mundo**.

```toml
[apps]
wasm_dir = "plugins"
enabled = ["facturacion"]
```

| Clave | Por defecto | Qué hace |
|---|---|---|
| `wasm_dir` | `"./plugins"` | Directorio del que se leen los componentes. |
| `enabled` | `[]` | Lista blanca de apps; vacío significa "todas las del directorio". |
| `plugin_tls_port` | sin definir | Puerto para rutas `tls-server` de una app. |
| `plugin_tls_ports` | `{}` | Puerto por app, con prioridad sobre el anterior. |

Una app listada en `enabled` sin componente es un **error de arranque**. Una app
que el operador pidió y desaparece en silencio es peor que un servidor que se
niega a levantar.

`wasm_dir` relativo se resuelve contra el proyecto (`--dir` o el directorio de
trabajo). `FERRIS_PLUGINS_DIR` puede mover los mundos fuera del proyecto; el
directorio de componentes sigue siendo `wasm_dir`.

## Descubrimiento

Se aceptan dos layouts, y solo uno se escanea en profundidad:

```text
plugins/
├── facturacion.wasm          # layout plano: gana si existen los dos
└── facturacion/
    ├── facturacion.wasm      # componente dentro de su mundo
    ├── customizations/
    ├── data/
    ├── files/
    └── secrets/
```

* `plugins/<app>.wasm` es lo que escribe `ferris build` y tiene prioridad. Una
  copia dentro del mundo nunca eclipsa un componente recién compilado.
* `plugins/<app>/<app>.wasm` permite publicar el mundo completo como una unidad.
* Nada más profundo se escanea: `customizations/`, `files/` o `secrets/` no se
  confunden con apps.
* `plugins/<app>.wasm` y `plugins/<app>/<app>.wasm` se descubren como la misma
  app; el plano gana.

```bash
ferris build                    # compila a wasm32-wasip2 y escribe plugins/<name>.wasm
ferris build --profile dev      # perfil de desarrollo
```

El nombre debe ser un identificador de crate: letras ASCII, dígitos, `-` y `_`,
hasta 64 caracteres. Un nombre con `/`, `.` o `..` se rechaza antes de convertirse
en componente de ruta.

## El mundo

Cada app habilitada posee `plugins/<app>/` con cuatro subdirectorios fijos:

| Directorio | Contenido |
|---|---|
| `customizations/` | Custom Fields y Property Setters exportados, un JSON por DocType. |
| `data/` | Datos propios de la app. |
| `files/` | Blobs que adjunta. |
| `secrets/` | Material sensible; nunca se sirve por HTTP. |

El CLI crea la estructura al arrancar `serve`, `run` y `dev`. El guest la ve
montada, lectura/escritura, en `/world` (rutas absolutas: WASI no tiene un
directorio de trabajo global).

El montaje **es** el sandbox: wasmtime rechaza `..`, rutas que salen de la raíz y
un root que sea un symlink. El montaje es por instancia, así que una app no ve el
mundo de otra. La capacidad `filesystem` es primordial y se decide al instanciar,
antes de que `describe()` pueda declarar nada.

## Customizaciones

El editor del Desk escribe las mismas propiedades que la API. El payload que se
exporta tiene esta forma:

```json
{
  "doctype": "Invoice",
  "fields": [
    { "fieldname": "centro_costes", "fieldtype": "Data", "insert_after": "customer" }
  ],
  "properties": [
    { "property": "title_field", "value": "customer" }
  ]
}
```

```bash
# Exporta el estado actual del DocType al mundo de la app
curl -X POST http://localhost:8000/api/customization/Invoice/export \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"app": "facturacion"}'
```

La ruta escribe `plugins/<app>/customizations/<doctype>.json`. El nombre del
fichero se sanea, por eso el JSON lleva el `doctype` explícito: el stem no se
puede revertir.

`ferris migrate` lee `customizations/*.json` de cada mundo habilitado y hace
upsert en `tab_custom_field` / `tab_property_setter`. Es el modelo de fixtures de
Frappe: la app es dueña del payload y la base de datos es una proyección.

:::note
La importación ocurre en **migrate**, no en cada arranque. Una edición hecha en
el Desk después del último export no se revierte al reiniciar; el operador decide
cuándo gana la copia de la app.
:::

Los upserts son idempotentes: ejecutar `ferris migrate` dos veces no duplica
nada. Borrar un campo del JSON **no** borra la fila; eso es una acción explícita
del Desk, no un efecto secundario de un redeploy.

## Rutas y métodos

Con la feature `wasm`, el servidor publica:

| Ruta | Función |
|---|---|
| `/plugins/{app}/*` | Reenvía la petición a `handle-request` del guest. |
| `/plugins/{app}/asset/{*path}` | Assets estáticos de la app, same-origin. |
| `/plugins/{app}/widget/{widget}` | Markup SSR de un widget declarado. |
| `/api/plugins/{app}/{*rest}` | Superficie de API declarada por la app. |
| `/api/method/{method}` | Método del registro; una app puede sustituir un base. |

Las rutas propias de la app son una capacidad **primordial**: no se configuran
en `[apps]`. Tampoco hay `trusted`, listas de capacidades ni grants por app. Las
capacidades específicas (egress que amplía un límite, TLS, streams, MQTT, PKI y
`overrides`) se conceden al **declararlas** en `describe()`; el host las aplica y
rechaza el import si no están.

```toml
# Dos apps con rutas TLS necesitan un puerto cada una:
# un puerto no puede llevar dos certificados.
[apps]
enabled = ["portal", "kiosco"]
plugin_tls_port = 8443

[apps.plugin_tls_ports]
kiosco = 8444
```

## Arranque y diagnóstico

El orden importa: el CLI construye el `PluginStore` **antes** de `Server::run`,
porque `build_router` monta `/plugins` y registra un handler por método
declarado. Un store creado después no publicaría nada hasta el siguiente
reinicio. El reloj de épocas de wasmtime se arranca antes de ejecutar
`describe()`, para que incluso el trabajo de boot esté limitado.

```bash
ferris serve
ferris doctor      # estructura, config y target wasm
ferris info
```

Si un componente no aparece:

1. comprueba que el fichero está en `plugins/` y termina en `.wasm`;
2. comprueba `[apps] enabled` (una entrada sin fichero falla al arrancar);
3. ejecuta `ferris build` y vuelve a mirar el nombre del paquete, no el del
   binario;
4. revisa el log de `plugin_boot`: nombra el directorio y la app que no encontró.
