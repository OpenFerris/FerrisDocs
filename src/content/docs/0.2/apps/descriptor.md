---
title: descriptor y describe()
description: La forma exacta del descriptor, sección por sección, con la
  proyección JSON del host y las reglas que se validan al cargar la app.
slug: 0.2/apps/descriptor
---

`describe()` es el primer export que el host llama y el único obligatorio. Su
resultado es el contrato de la app: qué DocTypes publica, qué rutas monta, qué
métodos registra, qué widgets aporta y qué capacidades pide. Se devuelve como el
record tipado `descriptor`; el host no decodifica JSON del guest para esto.

## La forma

```wit
record descriptor {
    capabilities: list<capability>,
    routes: list<route>,
    auth-mode: route-auth,
    http-policy: option<http-policy>,
    tls-client: option<tls-client>,
    tls-server: option<tls-server>,
    doctypes: list<doctype>,
    themes: list<theme>,
    folders: list<folder>,
    workspaces: list<workspace>,
    methods: list<method>,
    ui-extensions: option<list<ui-extension>>,
    dashboards: option<list<dashboard>>,
    widgets: option<list<widget-def>>,
    website: option<list<website-route>>,
    assets: option<list<string>>,
    subscriptions: option<list<subscription>>,
    mqtt-subscriptions: option<list<mqtt-subscription>>,
    config: option<list<config-item>>,
    plugin-version: option<string>,
    requires: option<list<string>>,
}
```

Los campos hasta `methods` son **obligatorios**: una lista vacía es válida, pero
hay que escribirla. El resto es `option`, y `none` significa «no declaro esta
sección», no «la declaro vacía».

## Cómo se ve desde fuera

`GET /plugins/<app>` devuelve una proyección estable del descriptor:

```json
{
  "capabilities": ["tls-client", "overrides"],
  "routes": [
    { "id": "api", "method": "*", "path": "/notas", "kind": "http",
      "auth": "session", "body_limit": 262144, "tls_server": false, "listener": null }
  ],
  "auth_mode": "session",
  "doctypes": [
    { "name": "Nota", "is_submittable": false, "is_single": false,
      "allow_delete": true, "allow_copy": true, "allow_print": true,
      "fields": ["titulo", "cuerpo"], "indexes": [], "in_calendar": false }
  ],
  "themes": [],
  "folders": [],
  "workspaces": [],
  "methods": [
    { "name": "notas.resumen", "params": [], "returns": "object",
      "description": "Cuenta las notas", "overrides": false }
  ],
  "plugin_version": "0.1.0"
}
```

La proyección **redacta** el material TLS inline y nunca incluye valores de
`config`: solo su esquema. Un `auth` que no declaraste aparece como `inherit`.

## Sección por sección

### `capabilities`

Lo que la app pide. Las primordiales ya están concedidas y no hace falta
listarlas; declarar una específica **es** la concesión. Ver
[capacidades](/0.2/apps/capacidades/).

### `routes`, `auth-mode` y `route-auth`

`path` es un prefijo que se compara segmento a segmento; gana la coincidencia
más larga. El host no interpreta placeholders: te entrega `route-id` y el `path`
restante.

```wit
record route {
    id: string,
    method: string,          // GET, POST, … o "*"
    path: string,            // prefijo, p. ej. "/notas"
    kind: route-kind,        // http | %stream
    auth: option<route-auth>,
    body-limit: option<u32>,
    tls-server: option<tls-server>,
    listener: option<stream-listen>,
}
```

`auth` es uno de:

| `route-auth` | Comportamiento |
|---|---|
| `none` | se despacha como invitado anónimo; la app decide |
| `session` | exige sesión del Desk; el host responde `401` antes de despachar |
| `capability("<name>")` | exige `x-ferris-capability` contra la clave secreta `route.<name>.token` |

Una ruta sin `auth` hereda `auth-mode`. Una ruta `%stream` lleva `listener` y sus
conexiones llegan por `handle-stream` / `handle-stream-event`.

### `doctypes`

```wit
record doctype {
    name: string,
    is-submittable: bool,
    is-single: bool,
    allow-submit: bool,
    allow-cancel: bool,
    allow-amend: bool,
    allow-delete: bool,
    allow-copy: bool,
    allow-print: bool,
    allow-rename: bool,
    in-calendar: bool,
    in-kanban: bool,
    in-gantt: bool,
    in-tree-view: bool,
    in-report-view: bool,
    view: doc-view,
    fields: list<field>,
    indexes: list<index>,
    list-default-order: option<string>,
}
```

Los `allow-*` están **cerrados por defecto**: el host abre solo lo que declares,
y la autorización por rol sigue aplicándose por encima. `is-single` declara un
único documento con el nombre del DocType. `list-default-order` es
`"<campo> <asc|desc>"`; un campo o una dirección desconocidos caen a un valor
seguro, no fallan.

`field` es una variante: `name(string)` deja que el host infiera el fieldtype, y
`config(field-config)` declara tipo, etiqueta, `options`, `reqd`, `read-only`,
`precision`, `depends-on` y el resto. `in-list-view` es opt-in: el silencio
significa que el campo no es columna.

`indexes` crea índices sobre los campos y decide qué columnas ofrece el Desk.
`view` escoge qué se abre en `/desk/:module/:doctype/:name`:

| `doc-view` | Qué renderiza |
|---|---|
| `form` | el formulario de metadatos |
| `dashboard-native` | el dashboard cuyo id es el nombre del documento |
| `dashboard-fixed(id)` | un dashboard fijo del feed de UI |
| `dashboard-link(field)` | el dashboard que nombra ese campo del documento |
| `dashboard-document(format)` | un dashboard sobre los campos del documento |
| `custom` | el elemento `form.view` que declares |

### `methods`

```wit
record method {
    name: string,
    params: list<tuple<string, string>>,
    returns: string,
    description: string,
    overrides: bool,
}
```

Se publican en `POST /api/method/<name>` y se despachan a `handle-request` con el
route id reservado `method:<name>`, autorizados como el llamante. El cuerpo de la
petición es el JSON de parámetros.

`overrides = true` no crea un método: sustituye el handler del mismo nombre.
Exige la capacidad `overrides` y un método existente debajo. Si no lo hay, el
host registra el error y **no** publica el handler.

### `ui-extensions`, `dashboards`, `widgets`, `website`

Alimentan el feed `/api/ui-extensions`. El `name` de un `widget-def` es
kebab-case (minúsculas, dígitos y guiones); `component` se convierte en el custom
element `<ferris-…>`. Detalle y ejemplos en [UI extensions](/0.2/apps/ui-extensions/).

### `config`

Esquema, nunca valores. `value-type` es `string`, `number`, `bool` o `secret`.
Una clave `secret` es **del operador**: el guest no puede leerla ni escribirla, y
sus propios secretos van en `/world/secrets/`.

### `plugin-version` y `requires`

`plugin-version` es la versión de la app, la que ves en la proyección y la que
sirve para diagnosticar una instalación. `requires` declara dependencias para el
operador; no sustituye a ninguna comprobación del host.

## Qué valida el host

| Situación | Resultado |
|---|---|
| `overrides` sin la capacidad `overrides` | la app **no carga** |
| `overrides` sin método debajo | se registra el error y no se publica |
| ruta con prefijo del framework (`api`, `desk`, `plugins`, …) | ruta rechazada, con log |
| ruta `path = "/"` | rechazada: reclamaría todo el namespace |
| dos rutas con el mismo método y patrón | la segunda rechazada |
| ruta `%stream` sin `listener` | se reporta al arrancar, no se monta |
| `mqtt-subscription` sin destino o con los dos | error de validación |
| widget o extensión con nombre mal formado | se descarta con aviso |

Ningún rechazo es silencioso: siempre hay una línea de log con la app y el
motivo. La app sigue cargando salvo en el caso de `overrides`, que es un error de
instanciación.

:::caution[Una ruta nueva necesita reinicio]
La tabla de rutas se construye al arrancar. Una recarga en caliente reemplaza
descriptor, capacidades y handlers, pero una ruta **nueva** no se monta hasta
reiniciar: responde el 404 de siempre en lugar de arriesgar un router
inconsistente.
:::

## Buenas prácticas

* Declara solo lo que sirves. Una ruta declarada sin handler es una promesa que
  la app no cumple.
* Mantén `describe()` determinista: mismas listas y mismos nombres en cada
  llamada.
* No pidas capacidades específicas «por si acaso»; cada una amplía un límite del
  host y queda visible en `/plugins/<app>`.
