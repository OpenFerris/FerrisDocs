---
title: El contrato WIT
description: El world ferris-app, las seis interfaces de importación, los nueve exports, los tipos fundamentales y la regla de compatibilidad.
---

El contrato es un fichero WIT con una versión de paquete y un world. Todo lo
demás —tu lenguaje, tu runtime, tu estructura de proyecto— es indiferente.

```wit
package ferris:framework@0.3.0;

world ferris-app {
    import types;
    import data;
    import schema;
    import io;
    import platform;
    import descriptor;

    export describe: func() -> result<descriptor, error>;
    export handle-request: func(route-id: string, req: http-request) -> result<response, error>;
    export doctype-event: func(event: string, doctype: string, name: string, data: string) -> result<_, error>;
    export handle-stream: func(stream-id: string, chunk: list<u8>) -> result<list<u8>, error>;
    export handle-stream-event: func(stream-id: string, event: stream-event) -> result<_, error>;
    export handle-datagram: func(stream-id: string, data: list<u8>, peer: string) -> result<list<u8>, error>;
    export handle-job: func(job-type: string, payload: string) -> result<string, error>;
    export ui-asset: func(path: string) -> result<list<u8>, error>;
    export ui-widget: func(widget: string, params: list<tuple<string, string>>) -> result<string, error>;
}
```

Ese bloque es el contrato entero desde el punto de vista del host: seis imports
que la app puede llamar y nueve exports que el host puede llamar.

## Las seis interfaces

| Interfaz | Qué aporta | Capacidad asociada |
|---|---|---|
| `types` | vocabulario común: `error`, `capability`, `http-policy`, TLS, `route-auth` | — |
| `data` | documentos, consultas, agregados, naming, metadatos y `call-method` | `docstore-read`, `docstore-write`, `schema` |
| `schema` | declaración de un DocType completo desde JSON | `schema` |
| `io` | HTTP saliente, streams, datagramas, DNS, `publish`, `notify` | `http`, `streams`, `streams-listen`, `udp`, `raw-sockets`, `dns-server`, `pubsub`, `notifications` |
| `platform` | usuario, permisos, config, scheduler, PKI, procesos y detección de features | `config`, `scheduler`, `pki`, `process`, `threads` |
| `descriptor` | la forma tipada de `describe()` | — |

Las interfaces se declaran siempre para que el contrato sea estático, pero un
host puede estar compilado sin un vertical (realtime, jobs, email…).
`platform::features()` dice qué contiene el binario que te ejecuta; llamar a una
superficie ausente produce un error `internal` con el prefijo `unsupported: `.

### Documentos, ciclo de vida y metadata

`data` no solo lee y escribe documentos. La misma interfaz expone el ciclo de
vida y la metadata completa, para que una app no tenga que adivinar la forma de
un DocType:

| Función | Para qué |
|---|---|
| `list-docs`/`get-docs`/`count-docs`/`aggregate-docs` | consultas y agregados |
| `write-doc`/`apply-ops` | crear, actualizar, upsert y borrar (una transacción en el batch) |
| `next-name` | reservar el siguiente valor de una serie |
| `rename-doc` | mover la clave primaria con `before-rename`/`after-rename` |
| `set-docstatus` | `submit`, `cancel` o `amend` con las mismas reglas que la ruta REST |
| `doctype-json` | la metadata completa: campos, layout, `virtual`, `allow-on-submit`, naming, vistas, actions, links y permission types |
| `field-types` | el vocabulario canónico de fieldtypes |
| `get-doctype`/`list-doctypes` | la forma básica y el catálogo |
| `call-method` | ejecutar el handler siguiente en la cadena de overrides |

`doctype-json` es la vía para leer la metadata efectiva sin hardcodear campos;
el Desk usa la misma proyección en `GET /api/doctype/meta/{doctype}`. Las
operaciones nuevas son funciones, no campos de un `record`, así que un guest
compilado contra una versión anterior sigue instanciando.

### Declarar un DocType completo

`descriptor.doctype` es el subconjunto cómodo que el host valida al cargar. Si
tu app necesita una propiedad que ese subconjunto no lleva (tipo de naming, una
vista guardada, `allow-on-submit`, `mask`, cambios rastreados, flags de impresión
por campo…), llama a `schema.declare-doctype(json)` **dentro de `describe()`**
con un JSON de `ferris_schema::DoctypeMeta` (la definición de registro; la
proyección de lectura es `data.doctype-json`). Las propiedades ausentes toman su
valor por defecto; `name`, `fieldname` y `fieldtype` se validan antes de
registrar:

```wit
import schema;

// dentro de describe():
schema.declare-doctype(metadata-json)?;
```

El host valida el JSON (fieldtypes canónicos, nombre no reservado, propiedad
exclusiva de la app) y lo registra antes de servir la primera petición. Una
declaración inválida falla `describe()`: no queda una app a medio registrar.

## Los nueve exports

| Export | Contrato |
|---|---|
| `describe` | se llama al cargar; devuelve el `descriptor` |
| `handle-request` | una petición HTTP despachada con la política de su ruta |
| `doctype-event` | un punto del ciclo de vida de un DocType |
| `handle-stream` | un fragmento de bytes de un stream |
| `handle-stream-event` | `opened`, `closed` o `error` de un stream |
| `handle-datagram` | un datagrama UDP/raw/ICMP, con el peer que lo envió |
| `handle-job` | un trabajo con su `job-type` y su payload JSON |
| `ui-asset` | bytes de un asset servidos en `/plugins/<app>/asset/<path>` |
| `ui-widget` | HTML SSR de un widget, con los parámetros de la instancia |

El host solo llama a los exports cuya superficie declaraste: sin rutas no hay
`handle-request`; sin DocTypes no hay `doctype-event`; sin widgets no hay
`ui-widget`.

## El host ejecuta; la app controla

Las superficies nuevas siguen la misma regla: la app declara qué quiere y
controla el protocolo; el host posee el recurso.

| Superficie | La app controla | El host posee |
|---|---|---|
| UDP (`udp`) | el payload de cada datagrama y su respuesta | el descriptor, el bind y los límites |
| Raw/ICMP (`raw-sockets`) | la cabecera IP completa del paquete | el descriptor y la política |
| DNS (`dns-server`) | la zona: `origin`, registros y SOA | los sockets UDP+TCP, el puerto y las respuestas |
| Procesos (`process`) | programa, argumentos, entorno y `cwd` | el fork, las tuberías, el deadline y la limpieza |

Los datagramas entran por `handle-datagram(stream-id, data, peer)`: devuelves los
bytes que el host manda al mismo `peer`, o una lista vacía para descartar.
`stream-info.protocol` dice `udp`, `raw` o `icmp`. `threads` es la única capacidad
sin función WIT: el guest usa su propio runtime y solo consulta
`platform::features()`/`grants()`.

Los puertos no se configuran por app: `port` `none`/`0` es inferido y
`stream-describe` lo reporta junto a `local-addr`/`remote-addr`. `dns-serve` liga
UDP y TCP en el mismo puerto (53 por defecto). `platform::process-run` y
`process-spawn` capturan `stdout`/`stderr` y aplican `timeout-ms` (`0` = sin
límite); `cwd` es relativo a `/world` y no puede salir de él.

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

`capability` es un enum de 22 valores (diez primordiales y doce específicas);
`grant-set` es la lista efectiva que devuelve `platform::grants()`. Las
capacidades se explican en [capacidades](/apps/capacidades/).

### `descriptor`

El registro raíz de `describe()`. Se documenta aparte, con un ejemplo completo,
en [descriptor](/apps/descriptor/).

## Compatibilidad

- **Misma versión de paquete.** El host enlaza las interfaces de
  `ferris:framework@0.3.0`. Un componente compilado contra un paquete
  incompatible no instancia: los nombres de import y export no coinciden.
  Desde `1.0.0`, un host de la misma major acepta componentes compilados contra
  una versión anterior; mientras Ferris esté en `0.x`, cada minor se trata como
  un contrato distinto y el componente se recompila.
- **Adiciones.** Desde `1.0.0` una minor añade superficie retrocompatible;
  `platform::features()` es una lista **abierta**: una entrada que no conoces es
  una feature nueva, no un error. Consulta
  [Versionado](/referencia/versionado/) para la regla completa.
- **Ningún éxito inventado.** Si una superficie no está compilada en el host, la
  llamada falla con `internal` y el prefijo `unsupported: `. Es deliberadamente
  distinto de un error de la petición: aparece en logs y no se arregla
  reintentando.
- **Los nombres reservados son contrato.** Los route ids `plugins`, `api`,
  `page` y `method:<name>` no los eliges tú; los asigna el host.

## Cómo leer el contrato de tu propio binario

```bash
wasm-tools component wit mi-app.wasm
```

Debe listar los imports de `ferris:framework` con la versión `0.3.0` y los nueve
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
| declarar DocTypes, rutas, métodos y UI | [descriptor](/apps/descriptor/) |
| saber qué te concede el host | [capacidades](/apps/capacidades/) |
| reaccionar a cambios de documentos | [ciclo de vida](/apps/ciclo-de-vida/) |
| leer y escribir documentos | [documentos](/apps/data/) |
| servir endpoints y páginas | [mundo, rutas y métodos](/apps/mundo-y-rutas/) |
| montar widgets y páginas | [UI extensions](/apps/ui-extensions/) |
