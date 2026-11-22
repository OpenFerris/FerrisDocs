---
title: Capacidades
description: Las diez capacidades primordiales, las ocho específicas, cómo se
  conceden, qué devuelve permission-denied y quién posee los sockets y los
  certificados.
slug: 0.2/apps/capacidades
---

Una **capacidad** es un permiso sobre la app, no sobre una persona. Decide si la
app puede *llamar* a un import. Después, el host decide además qué filas ve el
usuario que actúa. Las dos comprobaciones son independientes y ambas obligatorias.

No hay perfiles ni una segunda tabla de aprobación: la concesión efectiva es la
suma de dos listas.

## Primordiales — siempre concedidas

Están desde que la app se instancia. No hace falta declararlas (listarlas es
redundante pero inocuo), no se configuran y no se pueden retirar:

| Capacidad | Qué abre |
|---|---|
| `routes` | declarar rutas y recibirlas en `handle-request` |
| `http` | HTTP saliente bajo `http-policy` y los topes del host |
| `docstore-read` | `list-docs`, `get-docs`, `count-docs`, `aggregate-docs`, metadatos |
| `docstore-write` | `write-doc`, `apply-ops`, `next-name` |
| `filesystem` | el mundo propio, `plugins/<app>/` montado en `/world` |
| `config` | claves de configuración no secretas de la app |
| `schema` | introspección de metadatos de DocType |
| `scheduler` | cron, `enqueue-job`, listar y cancelar schedules |
| `notifications` | `io::notify` |
| `pubsub` | `io::publish` en los canales declarados |

`filesystem` es primordial porque el montaje se resuelve al **instanciar**, antes
de que `describe()` pueda ejecutarse. Si dependiera de una declaración, ninguna
app tendría mundo. El preopen es el límite, no un flag posterior.

## Específicas — declarar es conceder

Se piden en `describe().capabilities`. No hay un segundo paso de aprobación: el
host las instala y son las que `platform::grants()` reporta.

| Capacidad | Qué amplía |
|---|---|
| `http-unrestricted` | ignora `allowed-hosts` y `allow-private`; conserva tamaño, timeout y redirects |
| `tls-client` | TLS saliente con certificado de cliente, CA propia, SNI y ALPN |
| `tls-server` | servir TLS/mTLS con el material de la app |
| `streams` | abrir streams salientes y recibir los entrantes aceptados |
| `streams-listen` | bindear un listener propio (`io::listen-stream`) |
| `overrides` | sustituir un método existente (base del host u otra app) |
| `pki` | firmar CSR con la CA del host, leer su certificado, revocar lo propio |
| `mqtt` | manejar el cliente MQTT del host |

```wit
// En describe()
capabilities: [tls-client, overrides, mqtt],
```

`tls-server` y `streams-listen` abren puertos del host; por eso quedan visibles en
`/plugins/<app>` y en el log al instalar la app. `mqtt` es una concesión de
**egreso**: el operador puede negarla no compilando el vertical.

## `permission-denied` nombra la capacidad

Una llamada fuera de la concesión devuelve:

```wit
permission-denied("http-unrestricted")
```

El texto es el nombre kebab-case de la capacidad, no un mensaje libre. El host lo
traduce a **403**. Ramifica sobre `platform::grants()` en lugar de probar
llamadas y capturar fallos:

```text
grant-set = platform::grants()
puede_mqtt = "mqtt" in grant-set.capabilities
```

`grants()` responde «¿qué puede esta app?». No responde «¿qué compiló el host?».
Para eso hay otra llamada.

## `platform::features()` no es una concesión

| Pregunta | Responde | Significado |
|---|---|---|
| `platform::grants()` | ¿qué puede esta app? | la concesión efectiva |
| `platform::features()` | ¿qué compiló este host? | qué superficies existen |

Una app necesita **las dos**. `features()` devuelve nombres como `api`, `web`,
`realtime`, `jobs`, `scheduler`, `email`, `files`, `print`, `report`,
`integrations`, `wasm`, `mqtt` y `full`, ordenados. La lista es abierta: una
entrada desconocida es una feature nueva, no un error.

```text
features = platform::features()
if "mqtt" in features and "mqtt" in platform::grants().capabilities:
    mqtt::subscribe("produccion", "sensores/+", at-least-once)
```

Si `mqtt` falta en `features()`, la interfaz no está: llamarla devuelve
`internal` con el prefijo `unsupported: `. Ese prefijo es la señal de «este
binario no tiene la superficie», deliberadamente distinta de un error de la
petición.

## El host es el dueño del socket

La app **nunca** resuelve un nombre, abre un socket ni hace un handshake. Declara
política y material; el host conecta:

```wit
record http-policy {
    allowed-hosts: list<string>,   // host exacto o "*.sufijo"; vacío = cualquiera
    allow-private: bool,           // loopback, RFC 1918, link-local
    max-body: option<u64>,
    timeout-ms: option<u32>,
    redirects: redirect-policy,    // none | limited(u8) | follow
    allow-credentials: bool,       // reenvía Authorization/Cookie
}
```

La política efectiva es la **más estricta** entre la declaración de la app, la de
la llamada concreta y los topes del host. Una llamada solo puede endurecer, nunca
ampliar. `max-body`, `timeout-ms` y `redirects` no se eluden ni con
`http-unrestricted`.

Lo mismo vale para TLS: el material tiene dos formas.

```wit
variant tls-material {
    pem(string),      // inline; el host lo redacta en toda proyección JSON
    secret(string),   // ruta dentro del mundo, p. ej. "secrets/client.pem"
}
```

`secret` es la forma recomendada para cualquier clave privada: rota sin un nuevo
`describe()`, no aparece en `/plugins/<app>` y el fichero vive en tu mundo, que es
tuyo.

:::danger[`verify: false` necesita `http-unrestricted`]
Desactivar la verificación del par es ampliar un límite de seguridad. Sin
`http-unrestricted`, la llamada es `permission-denied`, aunque tengas
`tls-client`.
:::

## Las claves `secret` son del operador

Una clave declarada con `config-item.value-type = "secret"` no se puede leer ni
escribir desde el guest:

```wit
permission-denied("config key `route.ingest.token` is `secret`")
```

El host la resuelve él mismo cuando la necesita (material TLS detrás de
`tls-material.secret`). Los secretos **de la app** van en `/world/secrets/`, que
es su propio directorio y no pasa por la configuración.

## Qué no hace una capacidad

* No salta los permisos por rol: una lectura que el usuario no puede hacer sigue
  siendo `permission-denied` con `docstore-read`.
* No añade un vertical al binario: `mqtt` en `grants()` no crea la interfaz si
  `features()` no la lista.
* No autoriza a otra app: cada concesión está ligada a la app que la declaró.
* No es un secreto: `/plugins/<app>` publica las capacidades declaradas.

## Comprobarlo

```bash
curl -s localhost:8000/plugins/mi-app | jq '.capabilities'
```

Lo que aparece ahí es lo que la app **pidió**. La concesión efectiva la reporta
`platform::grants()` desde dentro del guest, y coincide con la declaración porque
no hay otra capa de política.
