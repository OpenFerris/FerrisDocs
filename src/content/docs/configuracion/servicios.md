---
title: Servicios
description: "Ficheros, email, búsqueda, realtime, trabajos y scheduler: qué hace cada sección, sus defaults y su relación con las features."
---

Las verticales se configuran en secciones propias y se encienden en dos capas:
la feature de Cargo decide si el código existe y `[features]` si el proceso lo
arranca.

## Ficheros — `[files]`

```toml
[files]
backend = "local"
local_path = "./files"
max_file_size_mb = 50
allowed_extensions = []
image_optimization = true
image_quality = 85
```

| Clave | Por defecto | Notas |
|---|---|---|
| `backend` | `"local"` | `local`, `s3`, `azure`, `gcs` o `memory`. |
| `local_path` | `"./files"` | Raíz del backend local. |
| `max_file_size_mb` | `50` | Límite por fichero. |
| `allowed_extensions` | `[]` | Vacío significa "sin lista blanca". |
| `image_optimization` | `true` | Optimización de imágenes al subir. |
| `image_quality` | `85` | Calidad resultante. |
| `cdn_url` | sin definir | Prefijo público para servir adjuntos. |

Backends remotos: `s3` usa `bucket`, `region`, `endpoint`, `access_key_id`,
`secret_access_key` y `force_path_style`; `azure` usa `account`, `container` y
`access_key`; `gcs` usa `bucket` y `credentials_path`. Todos son opcionales y
solo se leen si `backend` los selecciona.

La feature `files` compila el store, `/api/files` y las descargas firmadas
`/files/{*path}`. `[features] files = false` deja la API de ficheros sin montar.

:::caution
El servidor monta `FileStore::open_shared()`, que toma la raíz de
`FERRIS_FILES_DIR` (o del directorio temporal) y usa los valores por defecto del
store: hoy `[files] backend`, `local_path`, límites y calidad de imagen no se
proyectan sobre él. Fija `FERRIS_FILES_DIR` si necesitas una ruta concreta.
:::

## Email — `[email]`

```toml
[email]
default_account = "soporte"
queue_concurrency = 10
retry_attempts = 3
retry_delay_secs = 60

[[email.accounts]]
name = "soporte"
email = "soporte@example.com"
smtp_host = "smtp.example.com"
smtp_port = 587
smtp_username = "soporte"
smtp_password = "..."
smtp_tls = false
smtp_starttls = true
# Entrante: con `imap_host` arranca el poller IMAP de esta cuenta.
imap_host = "imap.example.com"
imap_port = 993
imap_username = "soporte"
imap_password = "..."
imap_tls = true
imap_starttls = false
```

| Clave | Por defecto | Notas |
|---|---|---|
| `default_account` | `"default"` | Se acepta; el hub usa la **primera** cuenta del array. |
| `accounts` | `[]` | Sin cuentas, los envíos encolados fallan con un aviso claro. |
| `queue_concurrency` | `10` | Workers del worker de email. |
| `retry_delay_secs` | `60` | Base del backoff. |
| `imap_host` | — | Activa el poller IMAP de la cuenta; ausente o vacío lo desactiva. |
| `imap_port` | `993`/`143` | 993 con `imap_tls`, 143 con `imap_starttls`. |
| `imap_username` | `email` | Usuario del buzón; si falta se usa la dirección. |
| `imap_password` | — | Credencial del buzón. |
| `imap_tls` / `imap_starttls` | `false`/`false` | Excluyentes; sin ninguno la cuenta se rechaza (no se autentica en claro). |

`smtp_tls` es TLS implícito (normalmente puerto 465); `smtp_starttls` es el
upgrade sobre un puerto de submission (587). Son excluyentes en la práctica.
Lo mismo con `imap_tls` e `imap_starttls` (993 frente a 143).

La feature `email` compila el hub y su worker, y depende de `jobs`. La cola de
email se drena con la misma infraestructura que los trabajos normales. El
**poller IMAP** de cada cuenta arranca en el proceso que tiene rol `worker` o
`scheduler`, y se apaga con el `shutdown`; hace polling cada 60 s (no usa IDLE),
guarda cada mensaje como `Inbound Email` y lo marca `\Seen` solo después de
guardarlo. La guía de [Email](/guias/email/) describe el flujo y los límites.

:::danger
`smtp_password` e `imap_password` son cadenas en claro en `config/ferris.toml`;
no se cifran con `[secrets]`. Usa permisos de fichero o un gestor de secretos
que genere el fichero al arrancar. El transporte usa `rustls` (`ring`), nunca
`native-tls`, y nunca registra la contraseña.
:::

## Búsqueda — `[search]`

```toml
[search]
enabled = true
host = "http://localhost:7700"
api_key = "..."
index_prefix = "ferris"
batch_size = 1000
```

Los campos existen para una instalación con servicio de búsqueda externo. Hoy
`/api/search` **no** consume `host` ni `api_key`: es una búsqueda acotada del
Desk sobre la base de datos, que recorre los DocTypes con
`in_global_search` y limita resultados y número de DocTypes. No hay índice
externo ni sincronización. `[features] search = false` desmonta la ruta y
responde `404`. La feature de Cargo no existe: el código vive en `ferris-api`.

## Realtime — `[realtime]`

```toml
[realtime]
enabled = true
ping_interval_secs = 25
ping_timeout_secs = 60
```

Socket.IO se sirve en el **mismo listener** que la API, bajo `/socket.io`; no
abre un segundo puerto en `ferris serve`. `ping_interval_secs` y
`ping_timeout_secs` alimentan el motor de socketioxide. `host`, `port`,
`workers`, `max_connections_per_worker` y `redis_channel` forman parte del
modelo del núcleo, pero el servidor unificado no los usa para bindear ni para
dimensionar el proceso. Tampoco hay un bus entre réplicas: un evento solo
alcanza a los clientes conectados al mismo proceso.

La feature `realtime` compila el motor y su capa; `[features] realtime = false`
elimina el rol y la ruta.

## Trabajos — `[jobs]`

```toml
[jobs]
default_queue = "default"
worker_concurrency = 10
poll_interval_ms = 1000
default_timeout_secs = 300
max_retries = 3
retry_backoff_base_secs = 60
dead_letter_queue = "dead_letter"
```

| Clave | Efecto |
|---|---|
| `default_queue` | Cola que consumen el worker de la app y el scheduler. |
| `worker_concurrency` | Tareas simultáneas por worker; se fuerza a ≥ 1. |
| `poll_interval_ms` | Cadencia de sondeo de la cola. |
| `default_timeout_secs` | Valor del modelo; cada job lleva su propio timeout. |
| `max_retries` | Valor del modelo; cada job lleva su propio máximo. |
| `retry_backoff_base_secs` | Base del backoff exponencial. |
| `dead_letter_queue` | Cola de los trabajos que no se pudieron entregar. |

La cola usa Redis si `[redis] url` responde; si no, cae a una cola respaldada
por la base de datos, y el cambio queda en el log.

`queues` describe colas adicionales para consumidores propios; el worker del
servidor consume `default_queue`. La feature `jobs` compila la cola y el rol
`worker`; `[features] jobs = false` los elimina.

## Scheduler — `[scheduler]`

```toml
[scheduler]
enabled = true
timezone = "Europe/Madrid"
tick_interval_secs = 60
max_concurrent_jobs = 100
history_retention_days = 30
```

El scheduler ejecuta cron y encola los trabajos en `default_queue`. Necesita la
feature `scheduler` (que depende de `jobs`) y se arranca con
`ferris serve --scheduler`. Además del flag de configuración, el rol comprueba
`System Settings.enable_scheduler`: un operador puede parar el cron desde el Desk
sin relanzar el proceso con otro conjunto de roles.

## Redis — `[redis]`

```toml
[redis]
url = "redis://localhost:6379"
max_connections = 20
```

Redis es opcional: lo usa la cola cuando está disponible. Sin él, los trabajos
siguen funcionando contra la base de datos y el realtime mantiene su estado en
proceso. `REDIS_URL=redis://:clave@redis.internal:6379` sustituye la URL; la
contraseña se redacta en `ferris config show` y en los `Debug` del tipo.

## Resumen de dependencias

| Servicio | Feature de Cargo | Flag `[features]` | Necesita |
|---|---|---|---|
| Ficheros | `files` | `files` | Store local u objeto. |
| Email | `email` | `email` | `jobs`; cuentas SMTP. |
| Búsqueda | — | `search` | Nada externo. |
| Realtime | `realtime` | `realtime` | Nada; usa el listener principal. |
| Trabajos | `jobs` | `jobs` | Base de datos; Redis opcional. |
| Scheduler | `scheduler` | `scheduler` | `jobs`; `System Settings`. |
