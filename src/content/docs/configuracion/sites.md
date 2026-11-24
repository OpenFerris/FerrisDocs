---
title: Sitios
description: El layout de sites/<site>/, el catálogo global apps/, site_config.json, las copias con versión fijada y el arranque por sitio.
---

Un **sitio** es la unidad de despliegue de Ferris, heredada de Frappe: un
directorio bajo `sites/` con su propia base de datos, su raíz de ficheros, su
Redis, su política de idiomas y sus **instancias** de app. Un bench puede tener
varios sitios; cada proceso sirve uno (`ferris serve --site <nombre>`), y
`--all-sites` levanta uno por sitio detrás de un despachador por `Host`.

La regla que sostiene el diseño son **dos ámbitos**: una app se instala una vez
en el catálogo global y cada sitio recibe una **copia** de su plantilla. Así,
actualizar el catálogo nunca sobrescribe los datos del sitio, y dos sitios nunca
comparten ni datos ni secretos.

## Layout

```text
sites/                              # FERRIS_SITES_DIR o <bench>/sites
├── common_site_config.json         # defaults del despliegue
└── <site>/
    ├── site_config.json            # config del sitio (0600: lleva la contraseña)
    ├── apps.txt                    # apps instaladas, una por línea
    ├── plugins/                    # ámbito de INSTANCIA
    │   └── <app>/
    │       ├── <app>.wasm          # COPIA del componente, con la versión fijada
    │       ├── config.toml         # [ferris] + [config] de este sitio
    │       ├── customizations/
    │       ├── data/
    │       ├── files/
    │       └── secrets/
    ├── private/                    # 0700: no se publica
    │   ├── <db>                    # base SQLite del sitio (si es SQLite)
    │   └── files/                  # adjuntos privados
    └── public/files/

apps/                               # ámbito GLOBAL (FERRIS_APPS_DIR)
└── <app>/
    ├── <app>.wasm
    ├── plugin.toml                 # manifest + defaults de [config]
    ├── world/                      # PLANTILLA que se copia al sitio
    │   ├── customizations/
    │   ├── data/
    │   ├── files/
    │   └── secrets/
    └── assets/
```

La base de datos SQLite de un sitio vive en `private/<db>`, dentro de su propio
directorio: se mueve con el sitio y `site delete` no deja el fichero en la raíz
del bench. `site_config.json` guarda solo el nombre (`db_name`); la ruta se
resuelve al abrir la base. Un sitio de un layout anterior, con el fichero en la
raíz del bench, lo adopta en la primera apertura (también sus `-wal`/`-shm`).

## Los dos ámbitos

| Ámbito | Dónde vive | Qué es |
|---|---|---|
| Global | `apps/<app>/` | Instalación única: componente, manifest y plantilla `world/`. Lo escribe `ferris build` o `ferris app install`. |
| Instancia | `sites/<site>/plugins/<app>/` | Lo único que el guest monta en `/world`. Es del sitio: datos, ficheros, secretos y `config.toml`. |

`ferris site install-app` copia la plantilla y aplica dos reglas que hacen segura
una actualización:

- `secrets/` se crea **vacío** y nunca se copia: el material sensible es del
  sitio, no de la app.
- En una reinstalación (`--force`) `data/` y `files/` no se tocan.
  `customizations/` **sí** se reemplaza, porque es la salida de la plantilla.

`config.toml` se **fusiona**, no se reemplaza: un valor que el operador editó
para este sitio sobrevive a la actualización y los defaults nuevos entran igual.

## Copia con versión fijada

La instancia guarda una **copia real** del `.wasm`, no un symlink. El sitio fija
la versión que instaló en `site_config.json`:

```json
{ "apps": ["billing"], "app_versions": { "billing": "0.1.0" } }
```

Consecuencias, todas deliberadas:

- Reemplazar `apps/billing/billing.wasm` (un build nuevo) **no** cambia lo que
  sirve un sitio ya instalado. La copia es su contrato.
- `ferris site install-app billing --site acme --force` es la única operación
  que copia la versión nueva y actualiza el registro.
- `ferris site info acme` imprime `versions:` con `app=version`, o `?` para una
  instalación anterior al registro.
- `ferris site uninstall-app` borra la entrada de `apps.txt` y de
  `app_versions`; sin `--purge` la instancia se conserva.

### Sitios creados antes del modelo de copia

Una instalación anterior guardaba `sites/<site>/plugins/<app>/<app>.wasm` como
symlink al catálogo. El arranque (`serve`/`run`/`dev --site`) y `ferris site
migrate` detectan ese enlace, lo sustituyen por una copia real y registran la
versión del catálogo si el sitio aún no la tenía. No hay que reinstalar a mano:
la primera operación de arranque o migración del sitio hace la conversión.

## `site_config.json`

Es la configuración base del sitio. Conserva las claves **planas** de Frappe
junto a las de Ferris, porque un fichero escrito por Frappe (o a mano) también
debe cargar; toda clave ausente toma su valor documentado.

```json
{
  "name": "erp.example.com",
  "host_name": "erp.example.com",
  "enabled": true,
  "redis_url": "redis://127.0.0.1:6379",
  "files_path": "/srv/app/sites/erp.example.com/private/files",
  "apps": ["facturacion"],
  "app_versions": { "facturacion": "0.1.0" },
  "plugins": { "facturacion": { "currency": "USD" } },
  "default_locale": "es",
  "supported_locales": ["es", "en"],
  "db_name": "erp_example_com",
  "db_type": "postgres",
  "db_host": "127.0.0.1",
  "db_port": 5432,
  "db_user": "erp_example_com",
  "db_password": "",
  "db_ssl_mode": "prefer"
}
```

| Clave | Significado |
|---|---|
| `name` | Nombre del directorio bajo `sites/`. Si falta, manda el directorio. |
| `host_name` | El `Host` que este sitio responde. Vacío significa el nombre del sitio. |
| `enabled` | Un sitio deshabilitado conserva sus datos, pero `--site` lo rechaza. |
| `redis_url` | Redis de este sitio (cola de trabajos y realtime). |
| `files_path` | Raíz de ficheros. Vacío significa `<site>/private/files`. |
| `apps` | Apps instaladas; se mantiene en paso con `apps.txt`. |
| `app_versions` | Versión de cada app en el momento de copiar su componente. |
| `plugins` | Overrides de `[config]` por app, aplicados al escribir `config.toml`. |
| `default_locale` | Locale por defecto del sitio. Vacío significa `en`. |
| `supported_locales` | Locales anunciados. Vacío significa `["en", "es"]`. |
| `db_name` | Nombre de la base. Vacío se deriva del sitio. |
| `db_type` | `postgres`, `mysql`/`mariadb` o `sqlite`. Un valor desconocido es un error, no un fallback. |
| `db_host`, `db_port`, `db_user`, `db_password`, `db_ssl_mode` | Conexión. `db_ssl_mode` toma `disable`, `allow`, `prefer` (por defecto), `require`, `verify-ca` o `verify-full`. |

`db_name` y `db_user` por defecto son el nombre del sitio con todo lo que no sea
letra, dígito o `_` sustituido: `erp.example.com` crea la base `erp_example_com`.

El fichero se escribe con permisos `0600` y su directorio con `0700`, porque
lleva la contraseña de la base. `site_config.json` y los `config.toml` de sitio
son material de operador: no se sirven por HTTP.

Un `host_name` ya servido por otro sitio se rechaza: dos sitios con el mismo
`Host` harían que la resolución respondiera con uno arbitrario.

`ferris site new` hereda `default_locale` y `supported_locales` del `[i18n]` del
bench. El detalle de catálogos y endpoints está en [i18n](/configuracion/i18n/).

`common_site_config.json` se crea junto al primer sitio con un `redis_url` por
defecto. Hoy los sitios creados con el CLI toman Redis de `[redis] url` del
proyecto, así que ese fichero es un punto de partida para el operador, no una
fuente que el arranque vuelva a leer.

## `apps.txt`

Lista de apps instaladas en el sitio, una por línea (`#` inicia un comentario).
Es la fuente que lee el arranque; `site_config.json` mantiene su copia en `apps`
y `app_versions` para que `ferris site info` las muestre. Una línea que no sea un
nombre de app válido (letras ASCII, dígitos, `-`, `_`) es un error, no una
entrada ignorada.

## `plugins/<app>/config.toml`

Cada instancia lleva su propia configuración en dos tablas:

```toml
[ferris]
site = "erp.example.com"
app = "facturacion"
version = "0.1.0"

[config]
currency = "EUR"
retries = 3
```

`[ferris]` es metadato de la instancia y el host lo ignora. `[config]` es la
configuración **efectiva** de esa app en ese sitio. La precedencia, de menor a
mayor, es:

1. el `[config]` de `apps/<app>/plugin.toml`;
2. el override `plugins.<app>` de `site_config.json`;
3. los valores que ya tenía el `config.toml` de la instancia.

La edición del operador es la más específica y por eso gana.

En cada arranque, antes de cargar el componente, el host proyecta `[config]`
sobre `tabAppConfig` (`plugin`, `key`, `value`), la tabla que el guest lee con
`config-get` y escribe con `config-set`. La escritura es aditiva e idempotente:
una clave que el plugin escribió y el fichero no nombra se conserva. La clave
`secret` es la excepción: un `secret` de tipo tabla o array falla el arranque de
esa app en vez de serializarse en claro.

Si el TOML no parsea, el arranque de esa app **falla** con un mensaje que nombra
el fichero.

:::note
Las customizaciones se aplican en `ferris migrate` y `ferris site migrate`, no en
el arranque: una edición hecha en el Desk sin exportar no se revierte al
reiniciar. `config.toml`, en cambio, se aplica en cada arranque.
:::

## `plugin.toml`

Es el manifest del catálogo global y el único sitio donde la app declara su
nombre, su versión y los defaults de configuración:

```toml
name = "facturacion"
version = "0.1.0"

[config]
currency = "EUR"
```

Un paquete es un directorio con `plugin.toml`, `<name>.wasm` y `world/`.

## Comandos

### Sitios

```bash
FERRIS_ADMIN_PASSWORD=... ferris site new erp.example.com \
  --host erp.example.com --admin-email admin@example.com

ferris site list
ferris site info erp.example.com
ferris site enable  erp.example.com
ferris site disable erp.example.com
ferris site migrate erp.example.com
ferris site delete  erp.example.com [--force]  # borra la configuración, no los datos
```

`site new` valida el nombre y el `Host`, **crea el operador** (`System Manager`)
en la base del sitio y escribe el layout. Un host duplicado se rechaza antes de
tocar ninguna base. `--db-type` acepta `postgres`, `mysql` o `sqlite`; el resto
de la conexión sale de `[database]`.

`site delete` borra solo la configuración. La base y la raíz de ficheros se
quedan, porque ninguna de las dos se puede deshacer sin una copia verificada.

### Apps

```bash
ferris build --app billing                 # paquete en apps/billing/
ferris app install apps/billing            # catálogo global
ferris app list --site erp.example.com

ferris site install-app billing --site erp.example.com           # primera vez
ferris site install-app billing --site erp.example.com --force   # nueva versión
ferris site uninstall-app billing --site erp.example.com
ferris site uninstall-app billing --site erp.example.com --purge # borra la instancia
```

Tanto `app install` como `site install-app` **instancian el componente** contra
el host antes de publicar. Un `.wasm` compilado contra un WIT incompatible falla
en ese momento, no en el siguiente arranque del sitio. `uninstall-app` saca la app
de `apps.txt`, así que el siguiente arranque deja de cargarla; sin `--purge` la
instancia se conserva para una reinstalación.

`ferris app remove` se niega mientras algún sitio tenga la app instalada: primero
se desinstala de cada sitio.

## Servir un sitio

```bash
ferris serve --site erp.example.com
ferris run   --site erp.example.com
ferris dev   --site erp.example.com
```

`--site` reescribe las rutas de datos del proceso **antes** de construir
cualquier pool: base de datos, raíz de ficheros, Redis, `[apps] enabled`,
`apps.wasm_dir` (que pasa a ser `sites/<site>/plugins`) y `[i18n]`. También
instala el `host_name` del sitio en la lista blanca de `Host`: una petición con
otro `Host` recibe `421 Misdirected Request`. Un sitio deshabilitado se rechaza al
arrancar.

`serve` usa `[server] roles` cuando no pasas ningún flag de rol, igual que
`ferris run`.

`--all-sites` levanta todos los sitios habilitados, uno por proceso, detrás de un
despachador por `Host` en un solo puerto. Los límites (TLS delante, HTTP/2) están
en [ferris serve y run](/cli/serve-y-run/).

:::note[Bundle del Desk]
El Desk hidratado carga `/pkg/ferris-web.js`. El servidor busca `./pkg`; si no
existe, usa `FERRIS_HOME/ferris-web/pkg` (o el `pkg/` del workspace con el que se
compiló la CLI). En un binario empaquetado, define `FERRIS_HOME` o copia el
bundle junto al proyecto; si falta, el API y el SSR responden pero el navegador
no hidrata.
:::

## Variables de entorno

| Variable | Efecto |
|---|---|
| `FERRIS_SITES_DIR` | Raíz de `sites/`. Por defecto `<bench>/sites`. |
| `FERRIS_APPS_DIR` | Catálogo global `apps/`. Por defecto `<bench>/apps`. |
| `FERRIS_PROJECT_DIR` | Proyecto con el que se resuelven las dos raíces. Por defecto el directorio de trabajo. |

## Ver también

- [Apps](/configuracion/apps/): descubrimiento de componentes, mundo y
  customizaciones.
- [i18n](/configuracion/i18n/): la política de idiomas del sitio.
- [ferris serve y run](/cli/serve-y-run/): flags de arranque y `--all-sites`.
