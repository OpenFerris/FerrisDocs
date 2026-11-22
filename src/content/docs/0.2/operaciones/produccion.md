---
title: Producción
description: Build, base de datos, Redis, JWT, TLS, CORS, workers, migraciones y
  actualización de una instalación Ferris.
slug: 0.2/operaciones/produccion
---

Esta página es la lista de decisiones que separan una instalación de desarrollo
de una que atiende tráfico real. No hay un modo "producción" mágico: Ferris
aplica lo que diga `ferris.toml` y falla cuando la configuración no se puede
cumplir.

## Build

```bash
# Todo, incluido MQTT
cargo build -p ferris-cli --release --features full

# Mínimo coherente: API + Desk
cargo build -p ferris-cli --release --no-default-features --features api,web
```

Una build mínima obliga a apagar en `[features]` todo lo que no se compiló:
`realtime`, `jobs`, `scheduler`, `email`, `files`, `print`, `report`, `search`,
`webhooks` y `mqtt` a `false`. El binario no adivina: si pides `print = true` sin
la feature, `serve` no arranca.

No compiles `full` "por si acaso": cada vertical añade dependencias, tiempo de
build y superficie de ataque. Elige las que uses y apaga el resto en las dos
capas.

## Base de datos

* **PostgreSQL o MySQL** para varias réplicas, backups en caliente y
  concurrencia real; **SQLite** para una instancia única, en un volumen
  persistente.
* `ssl_mode = "verify-full"` si la base cruza una red, y `max_connections` por
  debajo del límite del motor sumando réplicas y workers.

```toml
[database]
type = "postgres"
host = "db.internal"
port = 5432
name = "erp"
user = "ferris"
password = "..."
max_connections = 30
ssl_mode = "verify-full"
```

El pool se crea una vez por proceso. Un `worker` y un `api` separados abren cada
uno el suyo: cuenta ambos.

## Redis

Redis es opcional. Si está, la cola lo usa; si no, cae a la base de datos con un
aviso en el log. Para producción con varios workers, Redis evita que todos
compitan por las mismas filas.

```toml
[redis]
url = "redis://:clave@redis.internal:6379"
max_connections = 20
```

La contraseña embebida se redacta en los informes, pero sigue estando en el
fichero: inyéctala por `REDIS_URL` si el fichero se versiona.

## JWT y secretos

```bash
export FERRIS_JWT_SECRET="$(openssl rand -hex 32)"
export FERRIS_SECRET_KEY="$(openssl rand -hex 32)"
```

* Sin secreto JWT, con menos de 32 caracteres o con `change-me-in-production`,
  el arranque falla.
* Sin `[secrets] key`, el proceso arranca pero escribir o revelar un campo
  `Secret` falla; si el catálogo declara alguno, el arranque lo avisa.

La clave de `[secrets]` no se deriva del JWT: rotar la firma de tokens no debe
dejar ilegibles los secretos guardados.

## TLS

Dos opciones válidas, nunca las dos a medias:

### TLS en el proceso

```toml
[server]
external_url = "https://erp.example.com"

[server.tls]
cert_path = "/etc/ferris/tls/fullchain.pem"
key_path = "/etc/ferris/tls/privkey.pem"
min_version = "1.3"
```

Ventaja: las cookies de sesión se marcan `Secure` y el proceso conoce el
esquema. Coste: el certificado y su rotación son responsabilidad del proceso.

### TLS en el proxy

El proceso habla HTTP plano en la red interna; `external_url` sigue siendo
obligatorio para OAuth y para cualquier URL absoluta.

:::danger
Con TLS terminado en el proxy, `[server.tls]` no existe y las cookies **no** se
marcan `Secure`. Si eso no es aceptable, termina TLS en Ferris o añade la marca
en el proxy con una regla explícita.
:::

## CORS

Déjalo apagado si el Desk y la API se sirven desde el mismo origen, que es el
caso normal.

```toml
[server]
enable_cors = true
cors_origins = ["https://app.example.com"]
```

No hay comodín. Un `"*"` se rechaza con un aviso y la lista queda inerte. La capa
permite credenciales, así que un origen comodín sería un agujero, no una
comodidad.

## Límites

```toml
[server]
request_timeout_secs = 30
body_limit_mb = 25
```

* `request_timeout_secs` cubre la petición completa; al vencer responde `504`.
* `body_limit_mb` se aplica en el router. Alinéalo con el proxy.
* Los payloads MQTT tienen su propio techo (`[mqtt] max_payload_bytes`).

Un timeout bajo corta informes legítimos; uno alto mantiene ocupados los workers
con clientes lentos.

## Workers y scheduler

Un proceso `--all` sirve todo, incluido el cron. Con varias réplicas eso ejecuta
el scheduler varias veces. Separa roles:

```bash
# Réplicas de borde
ferris serve --api --web --realtime

# Una sola réplica de fondo
ferris serve --worker --scheduler
```

El scheduler, además, respeta `System Settings.enable_scheduler`: si está a `0`,
el rol arranca pero no ejecuta cron y lo dice en el log.

## Migraciones

```bash
ferris migrate --dry-run
ferris migrate
```

En un pipeline, el Job de migración corre contra producción y solo si termina
bien se arrancan o actualizan las réplicas; si falla, no sirvas la versión nueva.
No hay rollback automático: una migración aplicada se revierte restaurando una
copia o escribiendo otra migración; el `down_sql` generado no se ejecuta desde
el CLI. Antes de migrar, haz y prueba un backup
(ver [Backup y migraciones](/0.2/operaciones/backup-y-migraciones/)).

## Actualización sin downtime

Ferris no coordina versiones entre réplicas. Lo que sí puedes hacer: migraciones
compatibles hacia atrás (añadir antes, retirar después), migrar antes de cambiar
el tráfico, desplegar por oleadas comprobando `/health` y los logs, y mantener
un solo scheduler durante la transición. Lo que no puedes hacer es arrancar dos
versiones con esquemas incompatibles y esperar que la migración las reconcilie.

## Errores de arranque esperables

| Mensaje | Causa | Solución |
|---|---|---|
| `FERRIS_JWT_SECRET is not configured` | Falta el secreto | Definir la variable o `[auth] jwt_secret`. |
| `JWT secret must be at least 32 characters` | Secreto corto | Generar 32+ caracteres. |
| `the configuration asks for subsystems this binary was not compiled with` | Matriz de features | Recompilar o apagar el flag. |
| `every requested role was disabled...` | `[features]` vació los roles | Habilitar un rol o recompilar. |
| `tls.require_client_cert is set but tls.client_ca_path is missing` | mTLS incompleto | Añadir la CA o quitar la exigencia. |
| `invalid secret-field key material` | Clave AEAD malformada | 32 bytes en hex o base64. |
| `failed to bind host:port` | Puerto ocupado o host inválido | Cambiar `port`/`host`. |

## Después de arrancar

Ejecuta `ferris doctor` y `curl -s https://erp.example.com/health`, y revisa los
logs del primer minuto: roles activos, features apagadas, avisos de CORS, clave
de secretos y store de ficheros. Casi todos los problemas de una instalación
nueva se ven ahí antes que en una petición.
