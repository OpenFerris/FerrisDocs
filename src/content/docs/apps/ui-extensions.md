---
title: UI extensions
description: El feed /api/ui-extensions, los slots del Desk, widgets y dashboards, páginas de website, assets y dónde está el límite de confianza.
---

El Desk define el **marco**: slots, rejilla, resolución de widgets y aislamiento.
La app aporta definiciones desde `describe()`. El punto de encuentro es un único
feed.

## El feed

```http
GET /api/ui-extensions
```

```json
{
  "revision": "9c1f0a7be2d34c55",
  "apps": [{
    "owner": "mi-app",
    "extensions": [
      { "slot": "form.toolbar.right", "doctype": "Nota", "component": "nota-acciones",
        "label": "Acciones", "props": [["$titulo", "titulo"]] }
    ],
    "dashboards": [],
    "widgets": [],
    "assets": ["assets/nota.js", "assets/nota.css"]
  }]
}
```

`revision` es una huella del payload: el Desk puede saltarse el refetch mientras
no cambie y detectar una recarga, un dashboard guardado o un widget editado
cuando sí cambia.

Los widgets se siembran en el DocType `Widget` y los dashboards guardados se
añaden aparte; un fallo de lectura se registra y el resto sigue sirviendo.

## Slots

Un slot es un punto de montaje con nombre en una vista del host:

| Slot | Dónde | `doctype` |
|---|---|---|
| `form.toolbar.left`, `form.toolbar.right` | barra del formulario | obligatorio |
| `form.before_fields`, `form.after_fields` | alrededor de los campos | obligatorio |
| `form.sidebar.top`, `form.sidebar.bottom` | barra lateral del formulario | obligatorio |
| `form.view` | **toda** la vista; sustituye el formulario | obligatorio |
| `list.toolbar.bulk` | acciones masivas de la lista | obligatorio |
| `list.before_table` | encima de la tabla | obligatorio |
| `list.row.actions` | acciones de una fila | obligatorio |
| `shell.sidebar.bottom` | chrome del Desk | ignorado |
| `shell.topbar.right` | chrome del Desk | ignorado |
| `shell.header` | cabecera del Desk | ignorado |

```wit
record ui-extension {
    slot: string,
    doctype: option<string>,
    component: string,
    label: option<string>,
    props: list<tuple<string, string>>,
    requires: option<string>,
}
```

`component` es el nombre del custom element que la app define:
`nota-acciones` se monta como `<ferris-nota-acciones>`. El elemento se crea en un
shadow root, así que tus estilos no se escapan y los del Desk no te pisan.

En un slot por fila, una clave de `props` que empieza por `$` se proyecta desde el
documento (`"$titulo"`). `requires` limita quién ve la extensión; no es una
frontera de seguridad.

`form.view` es el único slot que **reemplaza** la vista entera en lugar de
añadirse. Debe nombrar su `doctype`; sin `doctype` nunca casa.

## Widgets

Un widget tiene dos niveles:

1. **definición** (`widget-def`): se publica al catálogo global bajo
   `owner.name`, y cualquier dashboard puede instanciarla;
2. **instancia** (`widget-instance`): una colocación con parámetros y tamaño en
   la rejilla `grid-12`.

```wit
record widget-def {
    name: string,
    label: string,
    component: string,
    code-path: option<string>,
    script: option<string>,
    stylesheet: option<string>,
    ssr: option<string>,
    renderer: option<string>,
    kind: string,                 // list | stat | chart | …
    params: list<widget-param>,
    events: list<string>,
    size: option<grid-size>,
    min: option<grid-size>,
    style: option<style-spec>,
    // …
}
```

`name` es kebab-case (minúsculas, dígitos y guiones). La definición posee el
custom element: N instancias montan N copias, y `events` refresca todas cuando
ocurre uno de esos eventos.

```wit
record widget-instance {
    id: string,
    widget: string,               // "mi-app.tareas" o "tareas"
    label: option<string>,
    params: list<tuple<string, string>>,
    span: option<u8>,             // 1..=12
    col: option<u8>,
    row: option<u16>,             // 0 = primera celda libre
    rows: option<u8>,             // 1..=64 filas de 72 px
    style: option<style-spec>,
}
```

### De dónde salen los bytes

| URL | Qué sirve |
|---|---|
| `/plugins/<app>/asset/<path>` | `ui-asset(path)` |
| `/api/widgets/<app>/<name>/script.js` | el `script` almacenado en el DocType `Widget` |
| `/api/widgets/<app>/<name>/style.css` | el `stylesheet` almacenado |
| `/plugins/<app>/widget/<widget>?params=…` | `ui-widget(...)`: HTML SSR |

Si `code-path` está declarado, el módulo se sirve en esa ruta original para que
sus `import` relativos resuelvan. `params` viaja como un array JSON de pares
codificado en la URL; el elemento montado recibe los mismos valores en
`data-params` y su referencia en `data-widget`.

## Workspaces y folders

`folder` agrupa iconos en la rejilla del Desk y `workspace` es una sección del
sidebar. Sus `items` son filas planas con `id` y un `parent` opcional (el grupo
debe aparecer antes); el host reconstruye el árbol. `icon` es un nombre de Lucide
o un SVG inline que el Desk sanea, y en un enlace `doctype` gana sobre `href`.

## Assets

`descriptor.assets` enumera los scripts y hojas de estilo que el Desk carga para
definir tus custom elements. Se sirven en `/plugins/<app>/asset/<path>` con el
content-type deducido de la extensión (`js`, `css`, `json`, `html`, `svg`, `png`,
`jpg`, `webp`, `woff2`, `wasm`; el resto cae a `application/octet-stream`).

```wit
assets: ["assets/nota.js", "assets/nota.css"],
```

Un asset `.js` que coincida con un `code-path` de un widget puede servirse desde
la fila editada del DocType `Widget`, para que una edición del Desk gane sobre la
copia embebida y los imports relativos sigan resolviendo.

## Dashboards

```wit
record dashboard {
    id: string,
    label: string,
    route: string,
    default: bool,
    style: option<dashboard-style>,
    widgets: list<widget-instance>,
}
```

`route` no puede ser `/` ni empezar por un prefijo reservado del Desk (`/api`,
`/plugins`, `/desk`, `/dashboard`, `/app`, `/settings`, …). El dashboard marcado
`default` es el que se muestra en la raíz del dashboard. Una ruta inválida o
duplicada se descarta con un aviso en el log.

## Website

```wit
record website-route {
    path: string,
    component: string,
    kind: string,      // "page" (con chrome) | "bare" (sin chrome)
}
```

```json
{
  "website": {
    "routes": [
      { "path": "/mi-app/blog/:slug", "component": "pagina-post", "type": "page" }
    ]
  }
}
```

En la proyección JSON el campo `kind` se llama **`type`**. El `path` admite
`:param` para un segmento y `*rest` para el resto, y se sirve como página del
Desk. `bare` renderiza sin barra lateral ni cabecera.

## El límite de confianza

:::danger[Los assets son código de confianza, no guest arenado]
Los scripts de `/plugins/<app>/asset/…` se sirven **en el mismo origen** que el
Desk. Pueden leer el DOM, usar la cookie de sesión y llamar a `/api/*` como el
usuario. El sandbox cubre los imports del componente WASM, **no** el JavaScript
que la app pide ejecutar al navegador. Instalar una app es confiar en su UI; el
host lo avisa en el log al arrancar.
:::

- **SVG** de iconos se sanea antes de renderizar;
- los **colores** de `style-spec` nombran un token semántico (`card`, `muted`,
  `accent`, …), nunca una clase ni un valor crudo; `*-custom` se inyecta como
  custom property;
- **`requires`** limita la visibilidad, no el acceso: los datos pasan por los
  permisos del host.

## Depurar el feed

```bash
curl -s localhost:8000/api/ui-extensions | jq '.revision, [.apps[].owner]'
curl -s localhost:8000/plugins/mi-app | jq '.widgets, .dashboards, .assets'
```

Si un widget no aparece: comprueba que la app está cargada, que la definición
tiene nombre kebab-case, que la fila del DocType `Widget` está habilitada y que
`revision` cambió tras la recarga. Si el script no carga, mira el content-type y
si `code-path` apunta a una ruta que `ui-asset` sabe servir.
