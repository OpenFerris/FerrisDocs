---
title: Realtime
description: WebSocket con socket.io, eventos de documento, salas, pubsub desde
  una app y reconexión.
slug: 0.2/guias/realtime
---

El Desk usa **socket.io** para empujar cambios sin recargar. El rol `realtime`
arranca ese servidor; sin él, el Desk sigue funcionando pero pierde la
actualización en vivo.

## Configuración

```toml
[server]
roles = ["api", "web", "realtime"]
cors_origins = ["https://desk.example.com"]

[realtime]
host = "0.0.0.0"
port = 8001
ping_interval_secs = 25
ping_timeout_secs = 60
```

| Clave | Efecto |
|---|---|
| `host` / `port` | listener del gateway (por defecto `0.0.0.0:8001`) |
| `ping_interval_secs` | cada cuánto late el servidor |
| `ping_timeout_secs` | cuánto espera antes de dar la conexión por muerta |
| `[server] cors_origins` | orígenes permitidos en el handshake |

El tamaño máximo de mensaje está fijado en **1 MiB** y no se configura por TOML.
`[realtime] enabled` lo reporta `ferris doctor`, pero quien decide si el rol
arranca es `[server] roles` junto con el feature compilado.

`realtime` es un **vertical de compilación**: un binario sin el feature no tiene
socket.io. Si `[features] realtime = true` pero el binario no lo compiló, el
arranque falla diciendo qué recompilar; no se ignora.

## Conectar desde el navegador

```js
import { io } from "socket.io-client";

// La sesión viaja en la cookie: el gateway la resuelve y autoriza la sala.
const socket = io("http://localhost:8001", { withCredentials: true });

socket.on("connect", () => {
  // Sala de DocType: requiere permiso de lectura; si no, llega `subscribe-error`.
  socket.emit("subscribe-doc", { doctype: "Nota" });
});

socket.on("subscribed", (ack) => console.log("dentro de", ack.room));
socket.on("subscribe-error", (err) => console.warn(err.error, err.room));
socket.on("realtime", (event) => console.log("evento", event));
```

Los eventos de cliente que el gateway entiende son `subscribe-doc`,
`subscribe-list`, `subscribe-comments` (y sus `unsubscribe-*`), `typing`,
`stop-typing`, `ping`, `activity`, `set-status` y `set-status-message`. Todo lo
que el servidor empuja llega por el evento `realtime`.

El gateway usa `socketioxide`; el cliente es el de socket.io. La ruta del bundle
del cliente depende de cómo lo sirvas (npm, CDN o tu propio build), no del
framework.

## Salas

| Tipo | Nombre | Para qué |
|---|---|---|
| `User` | `user:<id>` | notificaciones personales |
| `Doctype` | `doctype:<name>` | cambios de un tipo de documento |
| `List` | `list:<doctype>:<view>` | refresco de una lista |
| `Custom` | libre | lo que declare la app |

El host crea y destruye las salas de documento; las `Custom` las gestiona quien
las usa.

## Eventos

`ferris_realtime::EventType` cubre documento, lista, progreso, notificación y
discusión:

```text
DocInsert, DocUpdate, DocDelete, DocSubmit, DocCancel, DocAmend, DocRename
ListUpdate, ListInsert, ListRemove, ListReorder
Progress, TaskStarted, TaskCompleted, TaskFailed
Notification, Alert, Message
Comment, CommentDelete
```

El motor emite los de documento a través de `notify_doc_insert`,
`notify_doc_update`, `notify_doc_submit`, `notify_doc_cancel`,
`notify_doc_delete` cuando el rol está activo.

:::note[Evento no es garantía de entrega]
Realtime es *best effort*: si el socket está caído, el evento se pierde. Para
efectos que deben ocurrir, usa un job; para «refresca lo que el usuario está
mirando», usa realtime.
:::

## Publicar desde una app

`io::publish` entrega al bus SSE y a la sala socket.io `channel:<channel>`:

```rust
use ferris::framework::io;

io::publish("user:42:app:notas", "message", r#"{"texto":"listo"}"#)?;
```

Reglas:

* el canal debe estar **declarado** en `describe().subscriptions`; el host rechaza
  uno no declarado. La declaración es la aplicación de la política, no
  documentación;
* `event-type` es una cadena que el consumidor interpreta;
* `payload` es un JSON;
* si no hay un broadcaster de realtime registrado, la llamada **falla**. Un
  `Ok(())` con un warning dejaría a la app creyendo que entregó algo que nadie
  recibió.

```rust
subscriptions: Some(vec![descriptor::Subscription {
    channel: "user:42:app:notas".to_string(),
}]),
```

### Cómo llega al navegador

`io::publish` hace fan-out por dos vías:

* **SSE**: `GET /events?channel=<canal>` con `EventSource`. Requiere sesión y el
  canal debe estar en el namespace del llamante: `user:42` o `user:42:…`.
  Publicar en `app:test` **no** llega a un navegador; hay que publicar en
  `user:42:app:test`;
* **socket.io**: se emite el evento `realtime` a la sala `channel:<canal>`, con
  el mismo sobre que los eventos de documento.

```js
const events = new EventSource("/events?channel=user:42:app:notas");
events.addEventListener("message", (e) => console.log(e.data));
```

:::caution[El nombre del canal no es una capacidad]
El feed SSE filtra por el namespace `user:{id}` precisamente porque el payload es
JSON crudo de la app: si el nombre del canal bastara, cualquiera podría escuchar
`app:produccion`. Publica dentro del namespace del destinatario.
:::

## Notificaciones

`io::notify` es distinto de pubsub: no va a una sala, va a un destinatario por un
canal de entrega del host.

```rust
io::notify(
    &user.id,
    "in-app",
    "Reindexado",
    "Tus notas están al día",
)?;
```

Canales: `email`, `push`, `in-app`, `webhook`, `all`. La infraestructura de
entrega es del host; la app nunca gestiona un servidor.

## Reconexión

socket.io reintenta con backoff y vuelve a emitir `connect`; el cliente debe
**re-unirse a sus salas** en ese handler, porque una reconexión es una sesión
nueva del servidor:

```js
socket.on("connect", () => {
  socket.emit("subscribe-doc", { doctype: "Nota" });
  refetch(); // lo que cambió mientras estabas fuera no llega por el socket
});
```

`ping_interval_secs`/`ping_timeout_secs` deciden cuánto tarda el servidor en dar
por muerta una conexión. Un valor de ping mayor que el timeout de un proxy
intermedio produce desconexiones fantasma.

## Cierre ordenado

Al drenar el proceso, las conexiones upgrade se cierran con el handshake de
socket.io (`SocketIo::close()`), no esperando a que el navegador cierre la
pestaña. Es lo que permite que un despliegue no se quede colgado en el
`shutdown`.

## Checklist

* \[ ] El binario compiló `realtime` (`ferris info`).
* \[ ] El rol `realtime` está en `[server] roles`.
* \[ ] El proxy permite *upgrade* de WebSocket en `/socket.io/`.
* \[ ] Un canal publicado está en `subscriptions`.
* \[ ] El cliente se re-suscribe (`subscribe-doc`) tras reconectar.
* \[ ] Los canales pubsub están en `subscriptions` y dentro de `user:<id>` para
  llegar al navegador.
