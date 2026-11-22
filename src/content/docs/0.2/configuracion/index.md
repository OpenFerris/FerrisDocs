---
title: config/ferris.toml
description: Descubrimiento, precedencia y mapa completo de secciones del
  fichero de configuración de Ferris.
slug: 0.2/configuracion
---

Ferris se configura con un único fichero TOML, `config/ferris.toml`, relativo al
directorio del proyecto. El CLI lo carga antes de ejecutar cualquier comando y
lo fusiona sobre sus valores por defecto, de modo que un fichero parcial sigue
siendo válido. Un solo fichero mantiene la configuración efectiva atada al
proyecto, no a la máquina donde se ejecuta.

```text
mi-app/
├── Cargo.toml
├── config/
│   └── ferris.toml
└── plugins/
```

## Descubrimiento del fichero

`ferris` es global en todos los subcomandos con `--config`/`-c` y `--dir`/`-d`.

| Invocación | Fichero que se carga |
|---|---|
| `ferris --config /srv/app/config/ferris.toml serve` | Exactamente ese fichero. Si no existe, es un error. |
| `ferris --dir /srv/app serve` | `/srv/app/config/ferris.toml`, y el proyecto pasa a ser `/srv/app`. |
| `ferris serve` | `$PWD/config/ferris.toml`. |
| Ninguno de los anteriores y el fichero no existe | Solo valores por defecto y entorno. Es una configuración válida. |

Un `--config` explícito que no existe **no** cae silenciosamente a los valores
por defecto: devuelve `ConfigError::NotFound` con la ruta. Un `--dir` que no es
directorio termina el proceso con un error antes de ejecutar el comando.

`--dir` no solo elige el fichero: cambia el directorio de trabajo del proceso,
así que `Cargo.toml`, `plugins/`, `target/` y `tenants/` se resuelven dentro de
ese proyecto.

## Precedencia

De menor a mayor prioridad:

1. **Valores compilados** de `CliConfig::default()`.
2. **El fichero TOML**, fusionado tabla por tabla: las claves escalares y los
   arrays del fichero sustituyen a los del valor por defecto, y las tablas se
   combinan clave a clave.
3. **Variables de entorno concretas**, aplicadas siempre, haya fichero o no.

```toml
# config/ferris.toml — solo lo que cambia
[server]
port = 9000
```

```bash
# El entorno gana al fichero
SERVER_PORT=8080 ferris serve
```

El loader del CLI es propio: **no** lee `ferris.yaml` ni aplica un overlay
genérico de variables `FERRIS_*`. Las variables que sí se leen están en la
tabla de abajo; el resto se configura en el fichero.

### Variables de entorno reconocidas

| Variable | Efecto |
|---|---|
| `DATABASE_URL` | Se parsea a `[database]` solo para `postgres://`/`postgresql://`; el valor crudo queda en `custom.database_url`. |
| `REDIS_URL` | Sustituye `[redis] url`. |
| `FERRIS_JWT_SECRET` / `JWT_SECRET` | Sustituye `[auth] jwt_secret`. |
| `FERRIS_SECRET_KEY` / `FERRIS_SECRETS__KEY` | Clave de los campos `Secret`. |
| `FERRIS_SECRET_PREVIOUS_KEYS` | Claves anteriores, separadas por comas. |
| `SERVER_HOST`, `SERVER_PORT` | Sustituyen `[server] host` y `port`. |
| `FERRIS_BODY_LIMIT_MB` | Límite de cuerpo en MiB; `0` se ignora con un aviso. |
| `FERRIS_TLS_CERT`, `FERRIS_TLS_KEY` | Certificado y clave PEM del servidor. |
| `FERRIS_MTLS_CLIENT_CA`, `FERRIS_MTLS_REQUIRE` | CA de clientes y exigencia de certificado. |
| `FERRIS_TLS_MIN_VERSION` | `1.2` o `1.3`. |
| `FERRIS_CA_CERT`, `FERRIS_CA_KEY`, `FERRIS_CA_TTL_SECONDS` | CA interna (`[server.pki]`). |
| `FERRIS_REALTIME`, `FERRIS_JOBS`, `FERRIS_SCHEDULER`, `FERRIS_EMAIL`, `FERRIS_FILES`, `FERRIS_PRINT`, `FERRIS_REPORT`, `FERRIS_SEARCH`, `FERRIS_WEBHOOKS` | Booleanos que sustituyen el flag homónimo de `[features]`. |
| `FERRIS_MQTT` | Enciende o apaga `[mqtt] enabled` (solo el interruptor). |
| `FERRIS_HTTP_LOG` | `0` o `false` apaga los registros de petición en DocTypes. |
| `FERRIS_UNLOCK_SOURCE` | `[cli] unlock_source`, necesario para el hot-reload del frontend. |

Un valor booleano o numérico inválido se registra con `warn!` y se ignora; no
aborta el arranque.

## Secciones

| Sección | Para qué sirve | Página |
|---|---|---|
| `[project]` | Nombre, versión, autores y licencia de la aplicación. | — |
| `[database]` | Motor, conexión, pool y modo SSL. | [Base de datos](/0.2/configuracion/base-de-datos/) |
| `[redis]` | URL y conexiones para la cola de trabajos. | [Servicios](/0.2/configuracion/servicios/) |
| `[server]` | Listener, roles, límites, CORS, TLS, PKI y URL pública. | [Servidor](/0.2/configuracion/servidor/) |
| `[auth]` | JWT, sesiones, política de contraseñas, MFA y OAuth. | [Autenticación](/0.2/configuracion/autenticacion/) |
| `[files]` | Backend de ficheros y límites de subida. | [Servicios](/0.2/configuracion/servicios/) |
| `[email]` | Cuentas SMTP/IMAP y política de la cola. | [Servicios](/0.2/configuracion/servicios/) |
| `[search]` | Ajustes del servicio de búsqueda. | [Servicios](/0.2/configuracion/servicios/) |
| `[realtime]` | Ping, timeouts y canal de Redis. | [Servicios](/0.2/configuracion/servicios/) |
| `[jobs]` | Colas, reintentos y dead-letter queue. | [Servicios](/0.2/configuracion/servicios/) |
| `[scheduler]` | Zona horaria, tick y retención. | [Servicios](/0.2/configuracion/servicios/) |
| `[mqtt]` | Brokers, suscripciones y límites del cliente. | [MQTT y secretos](/0.2/configuracion/mqtt-y-secretos/) |
| `[features]` | Interruptores de subsistemas en tiempo de ejecución. | [Features](/0.2/configuracion/features/) |
| `[apps]` | Componentes WASM publicados y su directorio. | [Apps](/0.2/configuracion/apps/) |
| `[secrets]` | Clave AEAD de los campos `Secret`. | [MQTT y secretos](/0.2/configuracion/mqtt-y-secretos/) |
| `[cli]` | `unlock_source` para funciones que necesitan el árbol fuente. | — |
| `custom` | Mapa libre de valores JSON; Ferris no lo interpreta. | — |

`[project]` es informativo: el servidor no lo usa para enrutar ni para migrar.
`custom` existe para que una herramienta propia guarde datos junto a la
configuración; sus claves pasan por la redacción de secretos.

## Secretos y redacción

`ferris config show` imprime la configuración efectiva en JSON con estos
nombres de clave sustituidos por `<redacted>` en cualquier profundidad:

`password`, `passwd`, `secret`, `jwt_secret`, `token`, `access_token`,
`refresh_token`, `api_key`, `private_key`, `signing_key`.

Además, la contraseña embebida en una URL (`redis://user:clave@host`) se
enmascara conservando el usuario. Los `Debug` de `DatabaseConfig`,
`AuthConfig`, `RedisConfig`, `SearchConfig`, `EmailAccountConfig`, `S3Config`,
`AzureConfig`, `MqttBrokerConfig` y `CliConfig` están escritos a mano por el
mismo motivo: un `{:?}` en un log o en un fallo de test no puede imprimir una
credencial.

:::caution
La redacción es para **mostrar**, no para almacenar. El fichero
`config/ferris.toml` contiene los secretos en claro salvo los campos `Secret`
de la base de datos. Protege sus permisos o inyéctalo por entorno.
:::

## Ejemplo mínimo

Un proyecto SQLite que arranca sin servicios externos:

```toml
# config/ferris.toml
[project]
name = "mi-app"
version = "0.1.0"

[database]
type = "sqlite"
name = "mi-app.db"
host = ""
port = 0
user = ""
password = ""
max_connections = 5
ssl_mode = "disable"

[server]
host = "0.0.0.0"
port = 8000
roles = ["api", "web", "realtime"]

[apps]
wasm_dir = "plugins"
enabled = []
```

```bash
export FERRIS_JWT_SECRET="$(openssl rand -hex 32)"
ferris migrate
ferris serve
```

Sin `[auth] jwt_secret` y sin `FERRIS_JWT_SECRET`, `serve`, `run` y `dev`
fallan al arrancar: no hay secreto JWT utilizable por defecto.

## Comprobar la configuración

```bash
ferris config show     # JSON efectivo, secretos redactados; features en stderr
ferris config get server.port
ferris config set server.port 9000
ferris doctor          # valida matriz de features, base de datos, Redis y secretos
```
