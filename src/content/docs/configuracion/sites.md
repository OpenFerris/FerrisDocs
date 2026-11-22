---
title: Sitios
description: El layout de sites/<site>/, el catálogo global apps/, site_config.json, apps.txt y el config.toml de cada instancia de app.
---

Un **sitio** es la unidad de despliegue de Ferris, heredada de Frappe: un
directorio bajo `sites/` con su propia base de datos, su raíz de ficheros, su
Redis y sus **instancias** de app. Un proyecto puede tener varios sitios, pero
un proceso sirve exactamente uno (`ferris serve --site <nombre>`).

La regla que sostiene el diseño son **dos ámbitos**: una app se instala una vez
en el catálogo global y cada sitio recibe una copia de su plantilla. Así,
actualizar una app nunca sobrescribe los datos del sitio, y dos sitios nunca
comparten ni datos ni secretos.

## Layout

```text
sites/                              # FERRIS_SITES_DIR o <proyecto>/sites
├── common_site_config.json         # defaults del despliegue
└── <site>/
    ├── site_config.json            # config del sitio (0600: lleva la contraseña)
    ├── apps.txt                    # apps instaladas, una por línea
    ├── plugins/                    # ámbito de INSTANCIA
    │   └── <app>/
    │       ├── <app>.wasm          # symlink relativo al catálogo (o copia)
    │       ├── config.toml         # [ferris] + [config] de este sitio
    │       ├── customizations/
    │       ├── data/
    │       ├── files/
    │       └── secrets/
    ├── private/files/
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

## Los dos ámbitos

| Ámbito | Dónde vive | Qué es |
|---|---|---|
| Global | `apps/<app>/` | Instalación única: componente, manifest y plantilla `world/`. Solo lo escribe `ferris app install`. |
| Instancia | `sites/<site>/plugins/<app>/` | Lo único que el guest monta en `/world`. Es del sitio: datos, ficheros, secretos y `config.toml`. |

`ferris site install-app` copia la plantilla y aplica dos reglas que hacen segura
una actualización:

- `secrets/` se crea **vacío** y nunca se copia: el material sensible es del
  sitio, no de la app.
- En una reinstalación (`--force`) `data/` y `files/` no se tocan.
  `customizations/` **sí** se reemplaza, porque es la salida de la plantilla.

El componente no se duplica: `<app>.wasm` es un symlink relativo al catálogo y
solo se copia si el sistema de ficheros no admite enlaces.

`config.toml` se **fusiona**, no se reemplaza: un valor que el operador editó
para este sitio sobrevive a la actualización y los defaults nuevos entran igual.

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
  "plugins": { "facturacion": { "currency": "USD" } },
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
| `plugins` | Overrides de `[config]` por app, aplicados al escribir `config.toml`. |
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

`common_site_config.json` se crea junto al primer sitio con un `redis_url` por
defecto. Hoy los sitios creados con el CLI toman Redis de `[redis] url` del
proyecto, así que ese fichero es un punto de partida para el operador, no una
fuente que el arranque vuelva a leer.

## `apps.txt`

Lista de apps instaladas en el sitio, una por línea (`#` inicia un comentario).
Es la fuente que lee el arranque; `site_config.json` mantiene su copia en
`apps` para que `ferris site info` y `ferris site list` la muestren. Una línea
que no sea un nombre de app válido (letras ASCII, dígitos, `-`, `_`) es un
error, no una entrada ignorada.

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
features = ["facturas", "abonos"]
```

- `[ferris]` es metadato de la instancia: sitio, app y versión del manifest. El
  host lo **ignora**; existe para que el fichero se explique solo.
- `[config]` es la configuración **efectiva** de esa app en ese sitio.

La precedencia al escribir el fichero, de menor a mayor, es:

1. el `[config]` de `apps/<app>/plugin.toml`;
2. el override `plugins.<app>` de `site_config.json`;
3. los valores que ya tenía el `config.toml` de la instancia.

La edición del operador es la más específica y por eso gana: es el valor del
sitio, no un default de la app.

### Cómo llega al plugin

En el arranque (`ferris serve`, `run` y `dev`) **antes** de cargar cada
componente, el host proyecta `[config]` sobre `tabAppConfig` (`plugin`, `key`,
`value`), la misma tabla que el guest lee con `config-get` y escribe con
`config-set`. Así `describe()` y la primera lectura de configuración ya ven los
valores del sitio, sin una segunda fuente que reconciliar después.

| Valor TOML | Qué se guarda |
|---|---|
| string | El texto tal cual. |
| entero, decimal, booleano | Su forma textual (`3` → `"3"`, `true` → `"true"`). |
| array, tabla | JSON compacto, que el guest vuelve a parsear. |
| fecha/hora | Su forma textual. |

Dos garantías del arranque:

- **La escritura es aditiva e idempotente.** El fichero manda para sus claves;
  una clave que el plugin escribió con `config-set` y que el fichero no nombra
  se conserva. Arrancar dos veces no duplica ni borra nada.
- **La clave `secret` es la excepción.** `tabAppConfig` es texto plano y el
  material sensible lo resuelve el host, no un fichero de configuración: si
  `secret` es una tabla o un array, el arranque falla en vez de serializarlo en
  claro. Un `secret` de tipo string se escribe tal cual (por ejemplo, una ruta
  que el host resuelve).

Si el TOML no parsea, el arranque de esa app **falla** con un mensaje que nombra
el fichero. Un servidor que ignorara la configuración del operador y sirviera
defaults en silencio es peor que uno que se niega a levantar.

:::note
Las customizaciones (`customizations/*.json`) se aplican en `ferris migrate` y
`ferris site migrate`, no en el arranque: una edición hecha en el Desk sin
exportar no se revierte al reiniciar. `config.toml`, en cambio, se aplica en
cada arranque, porque no hay edición en el Desk que pueda perder.
:::

## `plugin.toml`

Es el manifest del catálogo global y el único sitio donde la app declara su
nombre, su versión y los defaults de configuración. Instalarla y llevarla a un
sitio leen el mismo fichero.

```toml
name = "facturacion"
version = "0.1.0"

[config]
currency = "EUR"
retries = 3
```

Un paquete es un directorio con `plugin.toml`, `<name>.wasm` y `world/`; también
se acepta un componente `.wasm` suelto, que se envuelve en un paquete mínimo.

## Comandos

### Sitios

```bash
FERRIS_ADMIN_PASSWORD=... ferris site new erp.example.com --admin-email admin@example.com

ferris site list
ferris site info erp.example.com
ferris site enable  erp.example.com
ferris site disable erp.example.com

ferris site migrate erp.example.com          # migra su base y aplica sus mundos
ferris site delete  erp.example.com [--force]  # borra la configuración, no los datos
```

`site new` valida el nombre y el `Host`, **crea el operador** (`System Manager`)
en la base del sitio y escribe el layout. Un host duplicado se rechaza antes de
tocar ninguna base.

| Flag de `site new` | Efecto |
|---|---|
| `--host <HOST>` | `host_name`; por defecto el nombre del sitio. |
| `--db-name <NAME>` | Nombre de la base; por defecto, el derivado del sitio. |
| `--db-type <TYPE>` | `postgres`, `mysql` o `sqlite`; por defecto `[database] type`. |
| `--admin-email <EMAIL>` | Obligatorio. Email del `System Manager` del sitio. |
| `--admin-password` | Obligatorio; mejor `FERRIS_ADMIN_PASSWORD`, porque un flag queda en el `argv` del proceso. |

Todo lo demás de la conexión (host, puerto, credenciales, `ssl_mode`) sale de
`[database]`: un sitio es otra base en el mismo servidor, no otro servidor.

`site delete` borra solo la configuración. La base y la raíz de ficheros se
quedan, porque ninguna de las dos se puede deshacer sin una copia verificada.

### Apps

```bash
ferris app install ruta/al/paquete      # catálogo global: apps/<app>/
ferris app list                         # catálogo global
ferris app list --site erp.example.com  # y lo instalado en ese sitio

ferris site install-app facturacion --site erp.example.com
ferris site install-app facturacion --site erp.example.com --force   # actualiza
ferris site uninstall-app facturacion --site erp.example.com
ferris site uninstall-app facturacion --site erp.example.com --purge # borra la instancia
```

`uninstall-app` saca la app de `apps.txt`, así que el siguiente arranque deja de
cargarla. Sin `--purge` la instancia se conserva para una reinstalación; con
`--purge` se borran sus datos, ficheros y secretos.

:::caution
`ferris app install` escribe en el catálogo `apps/` cuando `[apps] wasm_dir`
nombra ese catálogo (`wasm_dir = "apps"`). Si apunta a `plugins`, el comando
mantiene el contrato antiguo de un solo ámbito y copia el componente plano,
sin plantilla `world/` que un sitio pueda instalar.
:::

### Servir un sitio

```bash
ferris serve --site erp.example.com
ferris run   --site erp.example.com
ferris dev   --site erp.example.com
```

`--site` reescribe las rutas de datos del proceso **antes** de construir
cualquier pool: base de datos, raíz de ficheros, Redis, `[apps] enabled` y
`apps.wasm_dir` (que pasa a ser `sites/<site>/plugins`, el ámbito de instancia).
El pool, los ficheros y las apps publicadas nunca ven los valores de otro sitio.

También instala el `host_name` del sitio en la lista blanca de `Host`: una
petición con otro `Host` recibe `421 Misdirected Request`. Un sitio deshabilitado
se rechaza al arrancar.

`--tenant` es el modelo anterior a `sites/`; si necesitas instancias de app,
`--site` es el camino y los dos flags no se combinan.

:::note[Bundle del Desk]
El Desk hidratado carga `/pkg/ferris-web.js`. El servidor busca `./pkg`; si no
existe, usa `FERRIS_HOME/ferris-web/pkg` (o el `pkg/` del workspace con el que se
compiló la CLI). En un binario empaquetado, define `FERRIS_HOME` o copia el
bundle junto al proyecto; si falta, el API y el SSR responden pero el navegador
no hidrata.
:::

## Límite actual

**Un proceso sirve un sitio.** `--site` es una decisión de proceso, no un
enrutado por petición: no hay resolución `Host → sitio` dentro de un mismo
servidor, y por eso dos sitios son dos procesos (o dos contenedores) con puertos
distintos. El enrutado multi-sitio por `Host` en un solo proceso queda como fase
siguiente; el layout, el CLI y el arranque por sitio ya están preparados para
recibirlo.

## Variables de entorno

| Variable | Efecto |
|---|---|
| `FERRIS_SITES_DIR` | Raíz de `sites/`. Por defecto `<proyecto>/sites`. |
| `FERRIS_APPS_DIR` | Catálogo global `apps/`. Por defecto `<proyecto>/apps`. |
| `FERRIS_PROJECT_DIR` | Proyecto con el que se resuelven las dos raíces. Por defecto el directorio de trabajo. |

## Ver también

- [Apps](/configuracion/apps/): descubrimiento de componentes, mundo y
  customizaciones.
- [Servidor](/configuracion/servidor/): roles, `Host` y TLS del proceso.
- [ferris serve y run](/cli/serve-y-run/): flags de arranque.
