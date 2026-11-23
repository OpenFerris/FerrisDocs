---
title: Apps
description: Componentes WASM en el catálogo apps/ o en plugins/, su mundo, las rutas que publica el host y las customizaciones.
---

Una **app** de Ferris es un componente WebAssembly que declara DocTypes, rutas,
widgets, dashboards y métodos desde `describe()`. Implementa el contrato
`ferris:framework@<version>` del host (ver [El contrato WIT](/apps/wit/)). El
servidor lo descubre en disco, lo publica y lo aísla en su propio directorio,
llamado **mundo**.

```toml
[apps]
wasm_dir = "apps"        # bench; un --standalone usa "plugins"
enabled = []
```

| Clave | Por defecto | Qué hace |
|---|---|---|
| `wasm_dir` | `"./plugins"` | Directorio del que se leen los componentes. El scaffold de bench escribe `"apps"`. |
| `enabled` | `[]` | Lista blanca de apps; vacío significa "todas las del directorio". |
| `plugin_tls_port` | sin definir | Puerto para rutas `tls-server` de una app. |
| `plugin_tls_ports` | `{}` | Puerto por app, con prioridad sobre el anterior. |

Una app listada en `enabled` sin componente es un **error de arranque**. Una app
que el operador pidió y desaparece en silencio es peor que un servidor que se
niega a levantar.

`wasm_dir` relativo se resuelve contra la raíz del bench (o contra el directorio
de la app en un `--standalone`). `FERRIS_PLUGINS_DIR` puede mover los mundos
fuera del proyecto; el directorio de componentes sigue siendo `wasm_dir`.

## Dos catálogos, dos layouts

El **catálogo global** de un bench es `apps/`; cada subdirectorio es un paquete
listo para instalar en un sitio:

```text
apps/
└── facturacion/
    ├── facturacion.wasm    # el componente
    ├── plugin.toml         # name + version + [config]
    ├── world/              # plantilla: customizations, data, files, secrets
    └── assets/
```

El layout **plano** sigue funcionando, y es el de un `--standalone`:

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

- `plugins/<app>.wasm` es lo que escribe `ferris build` y tiene prioridad. Una
  copia dentro del mundo nunca eclipsa un componente recién compilado.
- `plugins/<app>/<app>.wasm` permite publicar el mundo completo como una unidad.
- Nada más profundo se escanea: `customizations/`, `files/` o `secrets/` no se
  confunden con apps.

Con `wasm_dir = "apps"`, el descubrimiento encuentra
`apps/<app>/<app>.wasm`: el paquete de catálogo. La app se publica en el host
igual que en el layout plano, pero además puede copiarse a un sitio con su
versión fijada. Ver [Sitios](/configuracion/sites/).

```bash
ferris build --app billing             # apps/billing/billing.wasm + plugin.toml + world/
ferris app install ruta/al/paquete     # publica en el catálogo global
ferris site install-app billing --site acme
ferris app list                        # qué hay en el catálogo y en qué sitios
```

El nombre debe ser un identificador de crate: letras ASCII, dígitos, `-` y `_`,
hasta 64 caracteres. Un nombre con `/`, `.` o `..` se rechaza antes de convertirse
en componente de ruta.

## El mundo

Cada app habilitada posee `<wasm_dir>/<app>/` con cuatro subdirectorios fijos:

| Directorio | Contenido |
|---|---|
| `customizations/` | Custom Fields y Property Setters exportados, un JSON por DocType. |
| `data/` | Datos propios de la app. |
| `files/` | Blobs que adjunta. |
| `secrets/` | Material sensible; nunca se sirve por HTTP. |

En un bench el mundo es `apps/<app>/`; en un sitio instalado,
`sites/<site>/plugins/<app>/`; en un `--standalone`, `plugins/<app>/`. El CLI
crea las cuatro carpetas al arrancar `serve`, `run` y `dev`. El guest la ve
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

La ruta escribe `<mundo>/customizations/<doctype>.json`. El nombre del fichero se
sanea, por eso el JSON lleva el `doctype` explícito: el stem no se puede
revertir.

`ferris migrate` lee `customizations/*.json` de cada mundo habilitado y hace
upsert en `tab_custom_field` / `tab_property_setter`. Es el modelo de fixtures de
Frappe: la app es dueña del payload y la base de datos es una proyección. En un
bench, `ferris build` copia esos JSON a `apps/<app>/world/customizations/` para
que viajen en el paquete; un sitio los recibe al instalarlo.

:::note
La importación ocurre en **migrate**, no en cada arranque. Una edición hecha en
el Desk después del último export no se revierte al reiniciar. Los upserts son
idempotentes: ejecutar `ferris migrate` dos veces no duplica nada. Borrar un campo
del JSON **no** borra la fila; eso es una acción explícita del Desk.
:::

## Rutas y métodos

Con la feature `wasm`, el servidor publica:

| Ruta | Función | ¿Producción? |
|---|---|---|
| Rutas declaradas (`path`) | `handle-request` con el `route-id` de la ruta. | Sí. |
| `/plugins/{app}` | Descriptor proyectado de la app. | Sí. |
| `/plugins/{app}/asset/{*path}` | Assets estáticos, same-origin. | Sí. |
| `/plugins/{app}/widget/{widget}` | Markup SSR de un widget. | Sí. |
| `/api/plugins/{app}/{*rest}` | Superficie de API declarada por la app. | Sí. |
| `/plugins/{app}/{*rest}` | Reenvío directo al guest. | **Solo en `ferris dev`.** |
| `/api/method/{method}` | Método del registro; una app puede sustituir uno base. | Sí. |

Las rutas que declara `describe()` se montan en la **raíz** del router y cada una
lleva su método, su `auth` y su límite de cuerpo. `/` se rechaza: reclamaría todo
el namespace. El scaffold declara `/apps/<app>` y un stream `/ws`.
`/plugins/<app>/*` es una superficie de desarrollo con sesión opcional: en
producción expondría el guest sin la política por ruta que sí aplican las rutas
declaradas y `/api/plugins`, así que `serve` responde `404` ahí. La entrada de
producción es la ruta declarada (por ejemplo `/apps/<app>`) o
`/api/plugins/<app>/*`.

El detalle de autorización, prefijos reservados y `%stream` está en
[Mundo, rutas y métodos](/apps/mundo-y-rutas/).

Las capacidades específicas (egress que amplía un límite, TLS, streams, PKI y
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
ferris doctor      # layout, config, WIT y target wasm
ferris info
```

`doctor` comprueba, dentro de una app, que `wit/ferris.wit` declara la versión del
host, y acepta tanto el layout de bench (`apps/` + `sites/`) como el de app
(`src/` + `wit/`). Si un componente no aparece:

1. comprueba que el fichero está en `wasm_dir` y termina en `.wasm`;
2. comprueba `[apps] enabled` (una entrada sin fichero falla al arrancar);
3. ejecuta `ferris build` y vuelve a mirar el nombre del paquete, no el del
   binario;
4. revisa el log de `plugin_boot`: nombra el directorio y la app que no encontró.
