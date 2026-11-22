---
title: Depuración
description: Hot reload, logs útiles, los fallos que verás al cargar un componente y una checklist para aislar el problema sin adivinar.
---

## `ferris dev` y la recarga

```bash
ferris dev                      # recarga de la app (por defecto)
ferris dev --hot-reload app     # recompila y sustituye el componente
ferris dev --hot-reload front   # solo el Desk
ferris dev --hot-reload both    # las dos cosas
```

El modo `app` está pensado para el scaffold de Ferris: recompila el componente y
**sustituye** la instancia cargada, volviendo a llamar a `describe()`. Si tu app
es de otro lenguaje, ejecuta tu propio build y reinicia el host (`ferris
serve`): el resultado es el mismo.

Lo que una recarga **no** hace:

| Cambio | ¿Necesita reiniciar? |
|---|---|
| cuerpo de `handle-request`, `doctype-event` o `handle-job` | no |
| DocTypes, eventos, métodos, temas, workspaces | no |
| capacidades declaradas | no |
| una **ruta nueva** en `routes` | **sí** |
| la configuración del host (`[apps]`, features) | sí |

Una ruta nueva responde el 404 de siempre hasta reiniciar: montar patrones en
caliente obligaría a validar colisiones contra la tabla viva, y un fallo ahí es
irrecuperable.

## Logs

El host escribe logs a stderr. Sube el nivel solo cuando lo necesites:

```bash
RUST_LOG=info  ferris dev
RUST_LOG=debug ferris dev
```

Al arrancar se registran, entre otras:

- cada ruta **rechazada**, con app, id y motivo
  (`declared route not mounted (fail-closed)`);
- un namespace de página que no se pudo montar
  (`app page namespace not mounted`);
- un método que sustituye a otro (`app method overrides an existing API`);
- un `overrides` sin base
  (`declared an overrides method with nothing below it; not registered`);
- el aviso de que los assets se sirven en el mismo origen;
- una capacidad declarada que el host no puede satisfacer (la app sigue cargando).

Los traps del guest se registran con la app y la llamada (`handle-request`,
`doctype-event`, …) pero sin mensaje del guest: un trap no tiene mensaje. Si ves
un trap, busca la excepción no capturada en tu código.

## Los fallos de carga

### 1. El componente no instancia

El host no puede compilar o instanciar el componente. Los mensajes suelen
distinguir tres casos: el `.wasm` no es un componente, falta un export del world
o el componente importa una instancia que el host no ofrece. Las causas típicas:

- compilaste un **módulo core** en vez de un componente;
- el `wit/ferris.wit` del proyecto no es el contrato (o lo editaste);
- falta un export del world;
- el componente importa una superficie que el host no ofrece.

```bash
wasm-tools validate mi-app.wasm
wasm-tools component wit mi-app.wasm | head -20
```

### 2. `permission-denied("…")`

El texto **es** el nombre de la capacidad que falta. No es un error del usuario:
es la app llamando fuera de su concesión. Declara la capacidad específica en
`describe().capabilities` y recarga. Las primordiales no se declaran porque ya
están.

Si la capacidad está declarada y sigue fallando, comprueba que el binario la
publica:

```bash
curl -s localhost:8000/plugins/mi-app | jq '.capabilities'
```

### 3. La ruta no existe

El host no la montó. Busca en el log `declared route not mounted` y comprueba:

- que el primer segmento no sea `api`, `desk`, `plugins`, `static`, `files`,
  `events`, `socket.io`, `pkg`, `health`, `login`, `logout`, `assets`,
  `favicon.ico`;
- que no sea `path = "/"` (reclama todo);
- que no colisione con otra ruta de la misma app u otra;
- que hayas **reiniciado** si la ruta es nueva;
- que el `route-id` que esperas sea el que declaraste (o `plugins`, `api`,
  `page`, `method:<name>` para los espacios del host).

### 4. El método no responde

```text
declared an `overrides` method with nothing below it; not registered
```

Un `overrides = true` sin base debajo no publica nada, a propósito. Si el método
es nuevo, pon `overrides: false`. Si de verdad sustituyes, declara la capacidad
`overrides` y verifica el nombre exacto.

### 5. El evento no llega

- ¿El DocType es exactamente el que declaraste?
- ¿El punto es uno de los 19 de [ciclo de vida](/apps/ciclo-de-vida/)?
- ¿El `event` llega en kebab-case (`before-save`, no `before_save`)?
- Si el handler anterior abortó, los posteriores no se ejecutan.

### 6. El job no se ejecuta

`handle-job` necesita que el rol `worker` esté activo y que la cola responda.
Comprueba el rol y la conexión con `ferris doctor`. Un job cuyo `job-type` no
maneja ninguna app cargada falla de forma visible: reintenta y acaba en la cola de
descartes, no se pierde en silencio.

### 7. Una superficie no compilada

```text
unsupported: …
```

El host se compiló sin ese vertical. Consulta `platform::features()` antes de
llamar y comprueba el binario con `ferris info`. Una capacidad declarada que el
host no compiló se registra y la app sigue cargando.

## Inspeccionar sin adivinar

```bash
# descriptor proyectado: capacidades, rutas, métodos, doctypes, widgets
curl -s localhost:8000/plugins/mi-app | jq .

# ¿está el componente donde el host lo busca?
ls -l plugins/mi-app.wasm plugins/mi-app/mi-app.wasm 2>/dev/null

# el mundo: lo que la app ha escrito
find plugins/mi-app -maxdepth 2 -type f | sort

# ¿qué compiló el binario?
ferris info

# el feed de UI
curl -s localhost:8000/api/ui-extensions | jq '.revision, [.apps[].owner]'
```

`/plugins/<app>` se genera **proyectando** el descriptor, no reenviando lo que
dijo el guest: si algo no aparece ahí, no está declarado. Redacta el material TLS
inline y no incluye valores de configuración.

```bash
# un jq que resuelve la mitad de las dudas
curl -s localhost:8000/plugins/mi-app \
  | jq '{caps: .capabilities, routes: [.routes[] | {id, method, path}],
         methods: [.methods[].name], doctypes: [.doctypes[].name]}'
```

## `ferris doctor`

```bash
ferris doctor
```

Comprueba toolchain, estructura del proyecto, ficheros de configuración, base de
datos, Redis, target WASM y la matriz de features del host. No inspecciona el
descriptor de una app: para eso está `/plugins/<app>`.

## Checklist de aislamiento

1. `ferris doctor` en verde.
2. El `.wasm` está en `plugins/<app>.wasm` (la forma plana gana) y su nombre es
   el de la app.
3. `[apps] enabled` está vacío o contiene exactamente ese nombre.
4. `/plugins/<app>` responde 200 y el descriptor lista lo que esperas.
5. La ruta aparece en `.routes` **y** no hay línea de rechazo en el log.
6. `platform::grants()` contiene lo que la llamada necesita; si no, el 403 lo
   nombra.
7. Para trabajos: el rol correspondiente está activo y la cola responde.
8. El usuario con el que pruebas tiene permiso sobre el DocType; una app no es
   un administrador.

:::caution[No borres la caché de build para “arreglar” algo]
Una recompilación completa del grafo tarda mucho y no explica por qué un
componente no instancia. El diagnóstico está en `wasm-tools component wit`, en
`/plugins/<app>` y en el log del host.
:::
