---
title: ferris shell y ferris benchmark
description: El REPL que reejecuta la CLI, el passthrough sin -- y los cinco benchmarks reales con sus límites de seguridad al escribir en Redis.
---

Dos comandos de uso interno: uno para encadenar la CLI sin salir del terminal y
otro para medir los caminos que el framework usa de verdad.

## `ferris shell`

Sin argumentos abre un REPL sobre la propia CLI:

```bash
ferris shell
```

```text
ferris> info
ferris> config show
ferris> !ls plugins
ferris> exit
```

Qué hace cada línea:

| Línea | Efecto |
|---|---|
| Vacía | No hace nada y vuelve a preguntar. |
| `exit` o `quit` | Cierra el REPL. `Ctrl-D` también. |
| `!<comando>` | Lo ejecuta con `sh -c`; un fallo no cierra el shell ni cambia su estado. |
| Cualquier otra | Se parte por espacios y se ejecuta como subcomando de `ferris`. |

Cada subcomando se lanza como **proceso nuevo** con el mismo ejecutable
(`current_exe`), no como una llamada en memoria. Si termina con código distinto
de 0, el REPL lo imprime pero sigue vivo.

Con argumentos, el comando es un passthrough y termina:

```bash
ferris shell doctor
ferris shell config get server.port
```

No hace falta `--` entre `shell` y el comando: `ferris shell info` es válido
porque `shell` no define otros flags. Si el subcomando falla, la CLI devuelve su
propio error con código 1 y el mensaje `` `ferris <cmd>` exited with N ``; no
propaga el código del hijo.

:::note Requiere un proyecto
Tanto el REPL como el passthrough comprueban que hay `Cargo.toml`. `ferris shell
info` fuera de un proyecto falla antes de ejecutar nada.
:::

## `ferris benchmark`

```bash
ferris benchmark [-w WHAT] [-i N] [-n WORKERS] [--allow-remote-write]
```

| Flag | Por defecto | Efecto |
|---|---|---|
| `-w`, `--what` | `all` | `api`, `database`, `realtime`, `jobs` o `print`. |
| `-i`, `--iterations` | `1000` | Operaciones por benchmark (mínimo 1). |
| `-n`, `--concurrency` | `8` | Workers y conexiones de base de datos. Techo 256; `0` se trata como 1. |
| `--allow-remote-write` | desactivado | Permite que `realtime` y `jobs` escriban en un Redis que no es esta máquina. |

`all` ejecuta los cinco en orden: API, base de datos, realtime, jobs y print.

### Qué mide cada uno

- **`api`** — peticiones HTTP a `/api/health` del servidor configurado
  (`http://<server.host>:<server.port>/api/health`) o a `FERRIS_BENCH_URL`. Antes
  de medir exige una respuesta 2xx: un 404 significa que el servidor está vivo
  pero no sirve ese endpoint, y eso no es una medición.
- **`database`** — `SELECT 1` (`health_check`) a través del pool, con
  `--concurrency` tareas. Ajusta `max_connections` al menos al número de workers.
- **`realtime`** — `PUBLISH` a un canal propio de la ejecución
  (`ferris:bench-<pid>-<nanos>`), así que no alcanza a los suscriptores de la
  app. No hay tráfico real y nada se guarda en disco.
- **`jobs`** — encola trabajos durables en una cola propia
  (`bench-<pid>-<nanos>`) y la borra al terminar (`DEL queue:<nombre>`).
- **`print`** — renderiza un PDF Typst con la primera plantilla incluida
  (`Invoice`) e informa del tamaño medio y máximo.

### Informe

Cada benchmark imprime `ops`, `throughput`, `min`, `mean`, `p50`, `p95`, `p99` y
`max`, más el número de errores y el primero de ellos si los hubo. Solo las
operaciones correctas cuentan como muestras: un fallo no aporta latencia.

Si no hubo **ninguna** operación correcta, el comando falla; no presenta una
tabla de ceros como resultado.

```text
== Database (SELECT 1) ==
  ops:           1000
  throughput:    8421.3 ops/s
  p50:           0.11ms
  p95:           0.28ms
```

### Seguridad de escritura remota

`realtime` y `jobs` **escriben** en el Redis configurado. El comando solo lo
considera local si el host es `localhost`, `127.0.0.1`, `::1`, `0.0.0.0` o el
hostname de esta máquina, y siempre que la URL sea TCP (un socket Unix no cuenta
como local). En cualquier otro caso se niega:

```text
the jobs benchmark enqueues 1000 durable jobs at redis://cache.internal:6379,
which is not this machine. Point redis.url at a local instance, or pass
--allow-remote-write if that is really where you meant to measure.
```

Publicar en el Redis real de otro equipo dispara sus handlers de realtime; por
eso la excepción es un flag explícito y no un valor por defecto.

## Ejemplos

```bash
# todos los benchmarks, con el servidor ya arrancado
ferris serve --api &
ferris benchmark

# solo base de datos, 5000 operaciones y 16 workers
ferris benchmark --what database --iterations 5000 --concurrency 16

# medir otro despliegue
FERRIS_BENCH_URL=https://erp.example.com/api/health \
  ferris benchmark --what api

# escribir en un Redis compartido, a sabiendas
ferris benchmark --what jobs --allow-remote-write
```

:::caution `api` no arranca el servidor
El benchmark de API solo mide: necesita un `ferris serve --api` (o un despliegue
equivalente) escuchando y un `/api/health` que responda 2xx. El de base de datos
sí abre su propio pool, y falla si la base configurada no es alcanzable.
:::
