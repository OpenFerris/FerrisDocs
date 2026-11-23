---
title: ferris serve y ferris run
description: Roles por flags o configuración, arranque por sitio, el despachador --all-sites por Host y el gating de features.
---

Los dos comandos arrancan **el mismo servidor**: un único puerto que sirve API,
Desk, realtime y los roles de fondo. La diferencia es de dónde salen los roles.

| | `ferris serve` | `ferris run` |
|---|---|---|
| Roles | Flags (`--api`, `--web`, …), `--all`, o `server.roles` si no hay flags. | `server.roles` de la configuración. |
| Host y puerto | `--host` / `--port`, con `0.0.0.0:8000` por defecto. | `server.host` / `server.port`. |
| Sitio | `--site <name>` o `--all-sites`. | `--site <name>`. |

## `ferris serve`

```bash
ferris serve [--host HOST] [-p PORT] [--api] [--web] [--realtime]
             [--worker] [--scheduler] [--all] [--cors-origin ORIGIN]...
             [--site NAME | --all-sites]
```

| Flag | Efecto |
|---|---|
| `--host <HOST>` | Dirección de escucha; por defecto `0.0.0.0`. |
| `-p`, `--port <PORT>` | Puerto; por defecto `8000`. |
| `--api` | Rutas REST `/api/*`. |
| `--web` | Desk (SSR e hidratación). |
| `--realtime` | socket.io en el mismo puerto. |
| `--worker` | Workers de fondo (cola de email, apps WIT). |
| `--scheduler` | Planificador de trabajos periódicos. |
| `--all` | Todos los roles compilados. |
| `--cors-origin <ORIGIN>` | Origen permitido para CORS. Repetible. |
| `--site <NAME>` | Sirve una instancia de `sites/<name>/`. |
| `--all-sites` | Sirve todos los sitios habilitados y despacha por `Host`. No se combina con `--site` ni `--tenant`. |

Sin ningún flag de rol, `serve` usa `[server] roles` del fichero, igual que
`ferris run`. Solo falla si tampoco hay lista en la configuración:

```text
no roles selected: pass --all, one of --api/--web/--realtime/--worker/--scheduler,
or list them in [server] roles
```

`--cors-origin` añade el origen a la lista del fichero y **activa** CORS: pasar
al menos uno implica `enable_cors = true`. No hay modo comodín; un `*` en la
lista se ignora con un aviso del servidor.

## `ferris run`

`ferris run` no acepta flags de rol. Lee `server.roles` y usa `server.host` y
`server.port`:

```toml
[server]
host = "0.0.0.0"
port = 8000
roles = ["api", "web", "realtime"]
```

Los nombres válidos son `api`, `web`, `realtime`, `worker`, `scheduler` y `all`,
sin distinguir mayúsculas. Un nombre desconocido es un error que lista los
aceptados. Una lista vacía también es un error, porque un servidor sin roles
responde a todo con un proceso que parece vivo.

Con un `config/ferris.toml` ausente, los valores por defecto incluyen
`roles = ["all"]`, así que `ferris run` sin fichero intenta arrancar todos los
roles.

## Servir un sitio

```bash
ferris serve --site erp.example.com
ferris run   --site erp.example.com
ferris dev   --site erp.example.com
```

`--site` reescribe las rutas de datos del proceso **antes** de construir
cualquier pool: base de datos, raíz de ficheros, Redis, `[apps] enabled`,
`apps.wasm_dir` (que pasa a ser `sites/<site>/plugins`, el ámbito de instancia)
y la política `[i18n]` del sitio. También instala su `host_name` en la lista
blanca de `Host`: una petición con otro `Host` recibe `421 Misdirected Request`.
Un sitio deshabilitado se rechaza al arrancar.

Los flags de rol siguen siendo opcionales: sin ellos se usan los del fichero, así
que `ferris serve --site acme` es un comando completo. `--site` y `--tenant` no
se combinan; `--site` es el modelo con instancias de app.

## `--all-sites`: un puerto, un proceso por sitio

```bash
ferris serve --all-sites --port 8000
```

Levanta **todos los sitios habilitados**, cada uno en un proceso hijo que escucha
en loopback, y un despachador delante que elige el hijo por la cabecera `Host`.
El registro de esquema es global, así que servir dos sitios en un mismo proceso
dejaría que los DocTypes de una app de un sitio taparan los de otro. El modelo
sigue siendo **un proceso por sitio**; lo que añade `--all-sites` es un único
punto de entrada.

- Un `Host` que no corresponde a ningún sitio responde `421 Misdirected
  Request`, igual que un proceso de un solo sitio.
- El despachador lee la cabecera de la petición y **empalma** la conexión TCP con
  el hijo elegido. Por eso funcionan HTTP/1.1 con keep-alive y las upgrades de
  WebSocket sin volver a implementar un proxy: una conexión queda ligada al
  sitio de su primer `Host`.
- **TLS debe terminar delante.** El despachador necesita el `Host` en claro; un
  `ClientHello` TLS directo se rechaza con `400` y un mensaje que lo dice. Pon
  el terminador TLS (proxy, balanceador o ingress) delante de este puerto.
- Una conexión HTTP/2 con *prior knowledge* no se despacha: no lleva la petición
  en texto claro que el despachador sabe leer.
- Los puertos de los hijos se eligen libres en `127.0.0.1`; el proceso padre los
  arranca, espera a que acepten y los termina al salir. Un hijo que no llega a
  escuchar falla el arranque con su log.

Para sitios con bases y ficheros independientes en máquinas distintas, sigue
siendo válido un proceso por sitio con su propio puerto y su propio terminador
TLS; `--all-sites` es la comodidad de un solo origen.

## Gating: dos capas que no se sustituyen

El arranque aplica dos decisiones distintas:

1. **Tiempo de compilación.** El binario solo contiene los subsistemas con los
   que se compiló. En una CLI mínima, `--web` no puede servir el Desk.
2. **Tiempo de ejecución.** `[features]` del fichero manda sobre `--all` y sobre
   `server.roles`: un `realtime = false` **quita** el rol aunque se haya pedido.

La secuencia real es:

1. `features::validate` (dentro de `settings_for`) compara lo que pide la
   configuración con lo compilado. Una petición imposible (por ejemplo
   `[features] print = true` en un binario sin `print`) falla **antes** de crear
   el pool, con el mensaje que dice qué `--features` hay que recompilar.
2. `serve::start` abre el pool y publica las apps de `[apps]`, salvo que el
   proceso ya traiga un store (es el caso de `ferris dev`).
3. `Server::run` vuelve a validar la matriz desde el lado del servidor, aplica
   `gate_roles` —con un aviso por cada rol eliminado— y, si no queda ninguno,
   falla:
   `every requested role was disabled by [features] or was not compiled into this binary…`.
   Después valida los settings y sirve.

Un build mínimo necesita que la configuración lo diga: con
`--no-default-features --features api,web`, un fichero que deja `realtime`,
`jobs`, `scheduler`, `email`, `files`, `print` o `report` en `true` no arranca.
Es deliberado; no se “arregla” relajando la comprobación.

:::caution `--all` no añade subsistemas
`--all` selecciona todos los roles, pero un rol cuyo subsistema no se compiló (o
que `[features]` apagó) lo descarta `gate_roles` con un aviso. En cambio, un gate
de `[features]` que pida algo ausente sí impide el arranque, porque es una
petición, no un permiso.
:::

## Apps y plugins

Ambos comandos publican los componentes de `apps.wasm_dir` antes de servir:

- en un bench, `wasm_dir = "apps"` y se publica `apps/<app>/<app>.wasm` (el
  paquete de catálogo);
- en un layout plano, `plugins/<app>.wasm` y `plugins/<app>/<app>.wasm` son
  válidos; el fichero plano gana si existen los dos, para que una copia vieja
  dentro del mundo no tape un build reciente;
- `[apps] enabled = []` carga todos los encontrados; una lista con un nombre sin
  fichero es un error de arranque, no un aviso;
- el nombre del app es el *stem* del fichero, con guiones incluidos.

`ferris dev` no pasa por este paso: ya publicó el artefacto que acaba de
compilar.

## Ejemplos

```bash
# API y Desk, en el puerto por defecto
ferris serve --api --web

# los roles que diga config/ferris.toml
ferris serve

# todo, permitiendo al Desk de otro origen
ferris serve --all --cors-origin https://desk.example.com

# API en 127.0.0.1:9000, sin Desk
ferris serve --api --host 127.0.0.1 --port 9000

# un sitio y todos los sitios
ferris serve --site acme
ferris serve --all-sites --port 8000
```

:::note Secreto JWT obligatorio
`serve` y `run` exigen `[auth] jwt_secret` (o `FERRIS_JWT_SECRET`/`JWT_SECRET`).
Sin él, el arranque falla con un mensaje que nombra la variable; no generan uno
al vuelo (solo `ferris dev` lo hace, en memoria).
:::
