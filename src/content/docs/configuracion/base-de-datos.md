---
title: Base de datos
description: Motores SQLite, PostgreSQL y MySQL, cadena de conexión, pool, SSL y migraciones en Ferris.
---

Ferris habla con SQLite, PostgreSQL y MySQL a través de un único punto de
entrada, `ferris_db::create_pool`. Esa función aplica el modo SSL, crea el
fichero SQLite si falta e instala la tabla de control de migraciones; ninguna
otra ruta del framework abre un pool por su cuenta.

:::note[Estado actual, no la visión]
**Un pool por backend, sin `sqlx::Any`**: `Db` guarda un `DbPool`
(`SqlitePool`, `PgPool` o `MySqlPool`), las filas y transacciones son concretas y
la API pública no cambia. **PostgreSQL** y **MySQL/MariaDB** tienen test vivo en
CI (`ferris-db/tests/{postgres,mysql}_live.rs`), además del test tipado con
columnas y tablas hijas (`ferris-document/tests/typed_live.rs`).

**Columnas y tablas hijas**: los campos declarados de un `DocType` tienen
columna real y las tablas hijas (`Table`) son tablas reales; son la **única**
fuente de verdad y el documento se reconstruye desde ellas (columnas de sistema,
columnas declaradas y filas hijas). No hay blob JSON por documento. Los únicos
JSON que se guardan son datos en sí: los campos declarados `JSON` y los
snapshots históricos de `tab_version` y de las lápidas de borrado
(`Deleted Document`). Los tipos son nativos:
`Date` es `DATE` (`TEXT` en SQLite), `Datetime` es `TIMESTAMP`/`DATETIME`
(`TEXT` en SQLite), `Currency`/`Percent` son `NUMERIC(21,9)`/`DECIMAL(21,9)`
(`NUMERIC` en SQLite), `Check` es `BOOLEAN` y `Float` es
`DOUBLE PRECISION`/`DOUBLE`/`REAL`. La lista empuja filtros y orden a las
columnas; solo lo que no es columna queda en Rust.
:::

## Rendimiento

- **SQLite**: WAL, `synchronous=NORMAL`, `busy_timeout=5s`, caché de 16 MiB y
  `mmap_size=256 MiB` por conexión. El pool se limita a **8 conexiones** (un solo
  escritor; más conexiones solo multiplican la caché). Un fichero, no
  `:memory:`, usa WAL.
- **PostgreSQL/MySQL**: pool con los tiempos de `[database]`, sentencias
  preparadas por conexión y tipos nativos (sin conversión a texto).
- **DDL**: la lista de tablas aseguradas se comparte por identidad de `Db`, no
  por `DocumentEngine`. Crear un motor por petición (el logger lo hace) ya no
  repite `CREATE TABLE`/`CREATE INDEX`.
- **Consultas**: la lista empuja filtros y orden a columnas nativas; declara
  `search_index` o `meta.indexes` para los campos que filtres.
- **Búsqueda**: índice de texto completo por motor (`FTS5`, `GIN`/`tsvector`,
  `FULLTEXT`), creado de forma perezosa y mantenido en cada escritura. La
  búsqueda es por **tokens/frases**, no subcadena; si el índice no está
  disponible, la lista cae al escaneo anterior.
- **Escritura**: las columnas del documento y sus tablas hijas van en la misma
  transacción; la versión de auditoría es la segunda fila esperada, no un N+1.
- **Logs**: cola acotada de 4096, lotes de 64/50 ms fuera del request path y
  retención diaria de `Path Log`/`API Request Log` (`FERRIS_LOG_RETENTION_DAYS`).

## Campos

| Clave | Tipo | Por defecto | Notas |
|---|---|---|---|
| `type` | string | `"postgres"` | `postgres`, `postgresql`, `pg`, `mysql`, `mariadb`, `sqlite`, `sqlite3`. |
| `host` | string | `"localhost"` | Ignorado por SQLite. |
| `port` | u16 | `5432` | Ignorado por SQLite. |
| `name` | string | `"ferris_dev"` | Base de datos; en SQLite, ruta del fichero o `:memory:`. |
| `user` | string | `"ferris"` | Usuario del motor. |
| `password` | string | `"ferris"` | Contraseña; se redacta en logs y en `config show`. |
| `max_connections` | u32 | `20` | Techo del pool. Debe ser mayor que 0. |
| `ssl_mode` | string | `"prefer"` | `disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full`. |

El tipo se compara sin separadores y sin distinguir mayúsculas: `verify_full`,
`verify-full` y `verifyfull` son el mismo modo. Un tipo o un `ssl_mode`
desconocido es un **error**, no un fallback silencioso a PostgreSQL o
`prefer`.

:::caution
Un `type` mal escrito es un **error**, no un fallback silencioso a PostgreSQL:
`type = "postgress"` detiene el comando con la lista de valores aceptados.
Conectar al motor equivocado es peor que no arrancar.
:::

## Cadenas de conexión

Ferris construye la URL a partir de los campos, con usuario, contraseña y
nombre **percent-encoded** para que un `@`, `:` o `/` en la credencial no
rompa la URL ni inyecte parámetros.

| Motor | Forma |
|---|---|
| PostgreSQL | `postgres://user:pass@host:port/db?sslmode=<modo>` |
| MySQL | `mysql://user:pass@host:port/db?ssl-mode=<MODO>` |
| SQLite (fichero) | `sqlite://<name>?mode=rwc` |
| SQLite (memoria) | `sqlite::memory:` |

`DATABASE_URL` se acepta como atajo, pero solo para PostgreSQL: se parsea a los
campos estructurados y el valor original queda en `custom.database_url`. Un
`sqlite://` o `mysql://` en esa variable no se aplica; se registra un aviso.

```bash
DATABASE_URL='postgres://ferris:secreto@db.internal:5432/erp?sslmode=require' \
  ferris migrate
```

## SQLite local

SQLite es el camino sin servicios externos y el que genera `ferris new`.

```toml
[database]
type = "sqlite"
name = "mi-app.db"
host = ""
port = 0
user = ""
password = ""
max_connections = 5
ssl_mode = "disable"
```

- `name` relativo se resuelve contra el directorio del proyecto, porque el CLI
  hace `cd` a `--dir` antes de ejecutar el comando.
- `name = ":memory:"` o vacío usa `sqlite::memory:`. Un pool en memoria debe
  quedarse en **una** conexión: una segunda vería otra base vacía.
- `mode=rwc` crea el fichero si no existe.
- `ssl_mode` no tiene efecto; se acepta para que el mismo esquema de
  configuración sirva en los tres motores.

## PostgreSQL

```toml
[database]
type = "postgres"
host = "db.internal"
port = 5432
name = "erp"
user = "ferris"
password = "una-clave-larga"
max_connections = 40
ssl_mode = "verify-full"
```

En producción, `verify-full` es la única variante que verifica certificado y
nombre de host. `require` cifra pero no autentica el servidor.

```bash
psql "postgres://ferris@db.internal:5432/erp" -c 'select 1'
```

## MySQL / MariaDB

```toml
[database]
type = "mysql"
host = "db.internal"
port = 3306
name = "erp"
user = "ferris"
password = "una-clave-larga"
max_connections = 40
ssl_mode = "verify-full"
```

MySQL usa la clave `ssl-mode` y sus propios nombres de modo; Ferris los traduce
en el dialecto para no enviar `sslmode`, que MySQL ignora.

## Pool

`create_pool` valida antes de abrir un socket:

- `create_pool` rechaza `max_connections = 0`; el CLI lo eleva a 1 antes de
  construir la configuración;
- un `min_connections` mayor que el máximo también es un error (sqlx lo
  recortaría en silencio).

El CLI fija `min_connections = 5` en el servidor (`SERVER_MIN_CONNECTIONS`) y deja
los tiempos del pool en los valores
del núcleo: `connect_timeout_secs = 10`, `idle_timeout_secs = 600`,
`max_lifetime_secs = 1800`. Esos tres campos **no** se exponen en
`config/ferris.toml`; el máximo de conexiones sí.

:::tip
Un `max_connections` alto no acelera nada si el servidor tiene menos CPU o el
plan de conexiones del motor es pequeño. Ajusta el pool al límite de la base,
no al número de peticiones concurrentes que te gustaría atender.
:::

## Migraciones

```bash
ferris migrate --dry-run    # lista las pendientes sin aplicar
ferris migrate              # aplica hasta la última
ferris migrate --target 12  # se detiene en una versión
ferris migrate --force      # checksum distinto pasa a aviso
```

`ferris migrate` construye el runner desde el pool que va a migrar, de modo que
dialecto y migraciones no pueden discrepar. Por cada DocType registrado genera
una migración `create_table_<doctype>`; dos DocTypes con la misma versión
derivada son un error explícito, no una tabla perdida.

Después de las tablas, el comando aplica las customizaciones de cada mundo de
plugin (`plugins/<app>/customizations/*.json`). Es el modelo de fixtures de
Frappe y se ejecuta en **migrate**, no al arrancar: una edición hecha en el Desk
después del último export no se revierte por reiniciar.

No hay comando de rollback. Las migraciones generadas llevan `down_sql`, pero
el CLI no lo ejecuta; para volver atrás se restaura una copia o se escribe una
migración nueva.

## Clasificación de errores

Los errores del driver se traducen una sola vez, en `ferris-db/src/error.rs`:

| Error del driver | Variante |
|---|---|
| `PoolTimedOut`, `PoolClosed` | `DatabaseError::PoolExhausted` |
| `Io`, `Tls` | `DatabaseError::Connection` |
| `RowNotFound` | `DatabaseError::NotFound` |
| violación unique, FK o check | `DatabaseError::Constraint` |
| cualquier otro | `DatabaseError::Query` |

Así el motor de documentos distingue un duplicado (`AlreadyExists`) de una fila
ausente o de una consulta rota sin parsear el texto del mensaje. Los conflictos
de transacción reintentables (deadlock, serialization failure, SQLite ocupado)
también se reconocen en un único sitio.

## Diagnóstico

```bash
ferris doctor
ferris info
```

`doctor` valida la configuración de base de datos y, si procede, intenta
conectarse. Un fallo de credenciales o de red aparece como check crítico, no
como un arranque a medias.
