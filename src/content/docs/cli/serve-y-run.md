---
title: ferris serve y ferris run
description: Las dos formas de arrancar el servidor unificado —roles por flags o roles desde la configuración—, el gating de features y los errores de arranque.
---

Los dos comandos arrancan **el mismo servidor**: un único puerto que sirve API,
Desk, realtime y los roles de fondo. La diferencia es de dónde salen los roles.

| | `ferris serve` | `ferris run` |
|---|---|---|
| Roles | Flags (`--api`, `--web`, …) o `--all`. | `server.roles` de la configuración. |
| Host y puerto | `--host` / `--port`, con `0.0.0.0:8000` por defecto. | `server.host` / `server.port`. |
| Sin roles | Error con la lista de flags. | Error que nombra `config/ferris.toml`. |

## `ferris serve`

```bash
ferris serve [--host HOST] [-p PORT] [--api] [--web] [--realtime]
             [--worker] [--scheduler] [--all] [--cors-origin ORIGIN]...
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

`--cors-origin` añade el origen a la lista del fichero y **activa** CORS: pasar
al menos uno implica `enable_cors = true`. No hay modo comodín; un `*` en la
lista se ignora con un aviso del servidor.

Sin ningún rol seleccionado el comando no arranca nada:

```text
no roles selected: pass --all or at least one of --api/--web/--realtime/--worker/--scheduler
```

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
sin distinguir mayúsculas. Un nombre desconocido es un error que lista
los aceptados. Una lista vacía también es un error, porque un servidor sin roles
responde a todo con un proceso que parece vivo:

```text
no roles in server.roles: nothing would be enabled. Add e.g.
roles = ["api", "web", "realtime"] to config/ferris.toml, or run
`ferris serve --all` to pick them on the command line.
```

Con un `config/ferris.toml` ausente, los valores por defecto incluyen
`roles = ["all"]`, así que `ferris run` sin fichero intenta arrancar todos los
roles.

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

Ambos comandos publican los componentes de `apps.wasm_dir` (por defecto
`plugins/`) antes de servir:

- `plugins/<app>.wasm` y `plugins/<app>/<app>.wasm` son válidos; el fichero plano
  gana si existen los dos, para que una copia vieja dentro del mundo no tape un
  build reciente;
- `[apps] enabled = []` carga todos los encontrados; una lista con un nombre sin
  fichero es un error de arranque, no un aviso;
- el nombre del app es el *stem* del fichero, con guiones incluidos.

`ferris dev` no pasa por este paso: ya publicó el artefacto que acaba de
compilar.

## Ejemplos

```bash
# API y Desk, en el puerto por defecto
ferris serve --api --web

# todo, permitiendo al Desk de otro origen
ferris serve --all --cors-origin https://desk.example.com

# API en 127.0.0.1:9000, sin Desk
ferris serve --api --host 127.0.0.1 --port 9000

# los roles que diga config/ferris.toml
ferris run

# el proyecto de otro directorio
ferris --dir /srv/billing run
```

:::note Secreto JWT obligatorio
Ambos comandos exigen `[auth] jwt_secret` (o `FERRIS_JWT_SECRET`/`JWT_SECRET`).
Sin él, el arranque falla con un mensaje que nombra la variable; `serve` y `run`
no generan uno al vuelo (solo `ferris dev` lo hace, en memoria).
:::
