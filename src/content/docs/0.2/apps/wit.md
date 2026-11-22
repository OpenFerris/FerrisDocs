---
title: El contrato WIT
description: El world ferris-app, las seis interfaces de importación, los ocho
  exports, los tipos fundamentales y la regla de compatibilidad.
slug: 0.2/apps/wit
---

El contrato es un fichero WIT con una versión de paquete y un world. Todo lo
demás —tu lenguaje, tu runtime, tu estructura de proyecto— es indiferente.

```wit
package ferris:framework@0.2.0;

world ferris-app {
    import types;
    import data;
    import io;
    import mqtt;
    import platform;
    import descriptor;

    export describe: func() -> result<descriptor, error>;
    export handle-request: func(route-id: string, req: http-request) -> result<response, error>;
    export doctype-event: func(event: string, doctype: string, name: string, data: string) -> result<_, error>;
    export handle-stream: func(stream-id: string, chunk: list<u8>) -> result<list<u8>, error>;
    export handle-stream-event: func(stream-id: string, event: stream-event) -> result<_, error>;
    export handle-job: func(job-type: string, payload: string) -> result<string, error>;
    export ui-asset: func(path: string) -> result<list<u8>, error>;
    export ui-widget: func(widget: string, params: list<tuple<string, string>>) -> result<string, error>;
}
```

Ese bloque es el contrato entero desde el punto de vista del host: seis imports
que la app puede llamar y ocho exports que el host puede llamar.

## Las seis interfaces

| Interfaz | Qué aporta | Capacidad asociada |
|---|---|---|
| `types` | vocabulario común: `error`, `capability`, `http-policy`, TLS, `route-auth` | — |
| `data` | documentos, consultas, agregados, naming, metadatos y `call-method` | `docstore-read`, `docstore-write`, `schema` |
| `io` | HTTP saliente, streams, `publish`, `notify` | `http`, `streams`, `streams-listen`, `pubsub`, `notifications` |
| `mqtt` | cliente MQTT ejecutado por el host | `mqtt` |
| `platform` | usuario, permisos, config, scheduler, PKI y detección de features | `config`, `scheduler`, `pki` |
| `descriptor` | la forma tipada de `describe()` | — |

`mqtt` es la única interfaz que puede **faltar en tiempo de ejecución**. Se
declara siempre para que el contrato sea estático, y `platform::features()` dice
si el host que te ejecuta compiló esa superficie. Llamar sin comprobarlo produce
un error `internal` con el prefijo `unsupported: `.

## Los ocho exports

| Export | Contrato |
|---|---|
| `describe` | se llama al cargar; devuelve el `descriptor` |
| `handle-request` | una petición HTTP despachada con la política de su ruta |
| `doctype-event` | un punto del ciclo de vida de un DocType |
| `handle-stream` | un fragmento de bytes de un stream |
| `handle-stream-event` | `opened`, `closed` o `error` de un stream |
| `handle-job` | un trabajo con su `job-type` y su payload JSON |
| `ui-asset` | bytes de un asset servidos en `/plugins/<app>/asset/<path>` |
| `ui-widget` | HTML SSR de un widget, con los parámetros de la instancia |

El host solo llama a los exports cuya superficie declaraste: sin rutas no hay
`handle-request`; sin DocTypes no hay `doctype-event`; sin widgets no hay
`ui-widget`.

## Tipos fundamentales

### `error`

Es el único canal de fallo. No hay excepciones ni códigos de estado inventados:
el host traduce el variante a un status HTTP sin leer el mensaje.

```wit
variant error {
    not-found(string),        // 404
    permission-denied(string),// 403
    validation-failed(string),// 422
    conflict(string),         // 409
    rate-limited(u32),        // 429, el número son segundos
    timeout(string),          // 504
    internal(string),         // 500
}
```

En `permission-denied` el texto es el **nombre kebab-case de la capacidad** que
falta, no un mensaje libre.

### `http-request` y `http-response`

```wit
record http-request {
    method: string,
    path: string,          // lo que sigue al prefijo; "/" para el prefijo mismo
    query: string,         // sin el "?"
    headers: list<tuple<string, string>>,
    body: list<u8>,
    client-identity: option<client-identity>,
}
```

Los nombres de cabecera llegan en minúsculas. `client-identity` solo aparece si
el host verificó un certificado de cliente; mapearlo a un dispositivo o a un
usuario es asunto tuyo.

La respuesta es `status`, `headers` y `body`. El host descarta cabeceras
hop-by-hop, `content-length` y las que posee el framework, y respeta tu status.

### `doc`

```wit
record doc {
    name: string,
    doctype: string,
    owner: string,
    docstatus: string,  // draft | submitted | cancelled
    data: string,      // el cuerpo del documento en JSON
}
```

`data` es siempre JSON, no un tipo generado por DocType. El límite es estable
aunque un DocType añada campos: tu app lee el JSON que pidió.

### `grant-set` y `capability`

`capability` es un enum de 18 valores; `grant-set` es la lista efectiva que
devuelve `platform::grants()`. Las capacidades se explican en
[capacidades](/0.2/apps/capacidades/).

### `descriptor`

El registro raíz de `describe()`. Se documenta aparte, con un ejemplo completo,
en [descriptor](/0.2/apps/descriptor/).

## Compatibilidad

* **Misma versión de paquete.** El host enlaza las interfaces de
  `ferris:framework@0.2.0`. Un componente compilado contra un paquete
  incompatible no instancia: los nombres de import y export no coinciden.
  Desde `1.0.0`, un host de la misma major acepta componentes compilados contra
  una versión anterior; mientras Ferris esté en `0.x`, cada minor se trata como
  un contrato distinto y el componente se recompila.
* **Adiciones.** Desde `1.0.0` una minor añade superficie retrocompatible;
  `platform::features()` es una lista **abierta**: una entrada que no conoces es
  una feature nueva, no un error. Consulta
  [Versionado](/0.2/referencia/versionado/) para la regla completa.
* **Ningún éxito inventado.** Si una superficie no está compilada en el host, la
  llamada falla con `internal` y el prefijo `unsupported: `. Es deliberadamente
  distinto de un error de la petición: aparece en logs y no se arregla
  reintentando.
* **Los nombres reservados son contrato.** Los route ids `plugins`, `api`,
  `page` y `method:<name>` no los eliges tú; los asigna el host.

## Cómo leer el contrato de tu propio binario

```bash
wasm-tools component wit mi-app.wasm
```

Debe listar los imports de `ferris:framework` con la versión `0.2.0` y los ocho
exports. Si aparece otro paquete o faltan exports, el componente no es una app de
Ferris aunque compile.

```bash
wasm-tools validate mi-app.wasm
```

La validación comprueba la estructura del componente, no la semántica de tu
código: un componente válido puede seguir devolviendo errores en cada llamada.

:::note[El WIT no es documentación opcional]
El host no decodifica JSON para descubrir tu superficie. `describe()` devuelve el
record tipado, y cada llamada cruza el límite con los tipos del contrato. Si un
tipo no está en el `.wit`, no existe.
:::

## Detalle de cada interfaz

| Quieres… | Lee |
|---|---|
| declarar DocTypes, rutas, métodos y UI | [descriptor](/0.2/apps/descriptor/) |
| saber qué te concede el host | [capacidades](/0.2/apps/capacidades/) |
| reaccionar a cambios de documentos | [ciclo de vida](/0.2/apps/ciclo-de-vida/) |
| leer y escribir documentos | [documentos](/0.2/apps/data/) |
| servir endpoints y páginas | [mundo, rutas y métodos](/0.2/apps/mundo-y-rutas/) |
| montar widgets y páginas | [UI extensions](/0.2/apps/ui-extensions/) |
