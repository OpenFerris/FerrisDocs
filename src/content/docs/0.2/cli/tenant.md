---
title: ferris tenant
description: Alta, listado, inspección, migración, activación y baja de tenants,
  dónde se guardan sus configuraciones y cómo se aíslan datos, ficheros y
  credenciales.
slug: 0.2/cli/tenant
---

`ferris tenant` administra tenants: cada uno es una configuración con su host,
su base de datos, su directorio de ficheros, su Redis y sus apps, más la
credencial del administrador inicial.

```bash
ferris tenant <subcomando>
```

| Subcomando | Argumentos | Efecto |
|---|---|---|
| `create` | `<name> <host> --admin-email <EMAIL> [--db-name <DB>] [--admin-password <PW>]` | Crea y aprovisiona un tenant. |
| `list` | — | Tabla de tenants, o aviso si no hay ninguno. |
| `info` | `<id>` | Ficha completa del tenant. |
| `delete` | `<id> [--force]` | Elimina **la configuración**; los datos se conservan. |
| `migrate` | `<id> [--target <VERSION>]` | Migra la base de ese tenant. |
| `enable` / `disable` | `<id>` | Activa o desactiva su resolución por host. |

`<id>` admite también el **nombre** del tenant: la búsqueda prueba primero por
identificador y luego por nombre.

## Dónde vive el registro

Cada tenant es un fichero JSON `<root>/<id>.json`, con un `id` UUID v7. El
directorio raíz es:

1. `FERRIS_TENANTS_DIR`, si está definido y no vacío;
2. `<proyecto>/tenants`, donde `<proyecto>` es el que resuelve `--dir`.

Así dos proyectos no comparten registro. Un fichero que no se puede leer o
parsear no desaparece en silencio: `list` emite un aviso por cada uno.

## `create`

```bash
ferris tenant create billing billing.example.com \
  --admin-email admin@example.com \
  --db-name billing_prod
```

Qué hace:

* `--db-name` es opcional; por defecto se usa el nombre saneado del tenant
  (minúsculas, caracteres no alfanuméricos a `_`).
* Aprovisiona el directorio de ficheros en
  `<files.local_path>/<tenant-saneado>`.
* Abre un pool contra la base del tenant. En SQLite eso crea el fichero y la
  tabla de contabilidad de migraciones; en PostgreSQL o MySQL **la base debe
  existir ya**.
* Guarda la contraseña del administrador como **hash Argon2**, no en claro.
* Exige que el `host` no esté ya asignado a otro tenant.
* Imprime `id`, `host`, base de datos, email de admin y ruta de ficheros.

### La contraseña del admin

Se resuelve en este orden:

1. `--admin-password <PW>`;
2. `FERRIS_ADMIN_PASSWORD`;
3. pregunta interactiva con la entrada enmascarada.

Un valor vacío se trata como ausente, así que `--admin-password ""` no crea un
tenant con contraseña vacía: se pregunta.

::\:danger `--admin-password` es visible en `ps`
La contraseña pasa a formar parte del `argv` del proceso y queda en el historial
del shell. Para scripts y CI usa la variable de entorno:

```bash
FERRIS_ADMIN_PASSWORD="$(openssl rand -base64 24)" \
  ferris tenant create billing billing.example.com \
  --admin-email admin@example.com
```

El comando avisa de este coste cuando se usa el flag.
::\:

## Aislamiento

Cada tenant lleva su propia configuración de base de datos (mismo motor, distinto
nombre de base), su `redis_url`, su `files_path`, su lista de apps y su host:

* **Datos**: bases separadas. No hay filtro por columna de tenant que se pueda
  olvidar en una consulta.
* **Ficheros**: un directorio por tenant bajo `files.local_path`.
* **Resolución por host**: el host identifica al tenant; un host duplicado es un
  error al crear. Un tenant `disabled` se salta en esa resolución sin borrar su
  configuración ni sus datos.
* **Credencial**: solo se guarda el hash Argon2 del administrador inicial.

::\:caution `tenant info` no redacta
La ficha imprime `redis_url` tal como está guardada. Si esa URL lleva contraseña
(`redis://:secreto@host:6379`), redacta la salida antes de compartirla. A
diferencia de `ferris config show`, este comando no enmascara secretos.
::\:

## `migrate`

`ferris tenant migrate <id>` abre la base **del tenant** y aplica el mismo runner
que `ferris migrate`, con el `--target` opcional. Una migración fallida hace que
el comando termine con error; no se queda en un aviso con código 0.

```bash
ferris tenant migrate billing
ferris tenant migrate billing --target 1000005
```

No aplica las customizaciones de los mundos de plugin: eso pertenece al
`ferris migrate` del proyecto.

## `delete`, `enable` y `disable`

* `delete` pide confirmación (`Delete tenant '<id>'? This removes its
  configuration (data is kept).`) y, con `--force`, no pregunta. Borra el JSON
  del registro; la base y los ficheros siguen ahí para que puedas archivarlos o
  borrarlos tú.
* `disable` conserva todo y deja de servir el tenant por host; `enable` lo
  devuelve al servicio.

```bash
ferris tenant list
ferris tenant info billing
ferris tenant disable billing
ferris tenant enable billing
ferris tenant delete billing --force
```

::\:caution `tenant` no arranca nada
Estos subcomandos escriben y leen el registro y, en `create`/`migrate`, tocan la
base. No levantan un servidor por tenant ni cambian el proceso en marcha: la
resolución por host ocurre en el servidor que sirve la instalación.
::\:
