---
title: ferris init y contexto
description: El modelo bench, la estructura de un sitio y los comandos que están disponibles según dónde ejecutes la CLI.
---

Ferris organiza el trabajo como un **bench** de Frappe: una carpeta con una
configuración, un catálogo de apps y un árbol de sitios. La CLI es sensible al
directorio desde el que se ejecuta: `ferris --help` muestra lo que de verdad
puede hacerse ahí, y un comando de otra zona falla antes de abrir ninguna base
de datos.

## Inicializar el bench

`ferris init` toma una carpeta **que ya existe** y la convierte en bench. No
crea un proyecto de aplicación ni borra nada: si la carpeta ya tiene un
`README`, un `.git` o un editor, se conservan.

```bash
mkdir acme && cd acme
ferris init
```

```text
acme/
├── config/ferris.toml          # una configuración para todas las apps y sitios
├── apps/                       # catálogo de apps (`ferris new <nombre>`)
└── sites/
    └── common_site_config.json # defaults compartidos por los sitios
```

`ferris init` es idempotente con la estructura, pero se niega a ejecutarse en
una carpeta que ya es un bench: allí lo que toca es crear una app o un sitio.

```bash
ferris init /ruta/a/carpeta     # sin cambiar de directorio
ferris --dir /ruta/a/carpeta init
```

## Dónde estás: las cuatro zonas

La zona se calcula desde el directorio actual, antes de interpretar el comando.

| Zona | Cómo se reconoce | Qué puedes hacer |
|---|---|---|
| **Bench** | `config/ferris.toml` + `apps/` o `sites/` | Crear apps (`new`), crear y gestionar sitios (`site`), instalar apps (`app`), construir (`build`), servir (`serve --site`, `serve --all-sites`), migrar, backup, doctor, config… |
| **Sitio** | estás dentro de `sites/<sitio>/` (con `site_config.json`) | `serve`, `run`, `migrate`, `backup`, `restore`, `site info/enable/disable/install-app/migrate`, `shell`, `info`, `doctor`, `config`… |
| **App** | estás dentro de `apps/<app>/` (con `Cargo.toml` o `plugin.toml`), o en un proyecto standalone | `dev`, `build`, `generate`, `shell`, `info`, `doctor`, `config` |
| **Fuera** | no hay bench hacia arriba | `init`, `new --standalone`, `info`, `doctor`, `config` |

Reglas que se aplican en todas las zonas:

- `ferris init` solo funciona fuera de un bench.
- `ferris new` crea una app en `apps/<nombre>`; fuera de un bench exige
  `--standalone` (proyecto de una sola app con su propio `config/ferris.toml`).
- `ferris dev` en la raíz del bench necesita `--app <nombre>`; dentro de
  `apps/<app>/` elige la app solo.
- Los subcomandos de `ferris site` que crean o borran (`new`, `list`, `delete`)
  son de la raíz del bench; `info`, `enable`, `disable`, `migrate`,
  `install-app` y `uninstall-app` funcionan también dentro del sitio.

El binario compilado sin la feature `wasm` no tiene `dev`, `build`, `app` ni
`deploy`; tampoco aparecen en la ayuda.

## El sitio manda

Dentro de `sites/<sitio>/` no hace falta repetir el nombre:

```bash
cd sites/acme
ferris serve            # = ferris serve --site acme
ferris migrate          # migra la base de datos de acme
ferris backup           # copia la base y los ficheros de acme
ferris site info        # = ferris site info acme
ferris site install-app shop   # = ferris site install-app shop --site acme
```

Los comandos que abren la base de datos aplican la configuración del sitio
antes de hacerlo, así que `migrate`, `backup`, `restore`, `shell` y
`role-permissions` trabajan sobre el sitio, nunca sobre la base del bench.

## Todo el sitio vive en su carpeta

Un sitio es un directorio autocontenido:

```text
sites/acme/
├── site_config.json        # host, base de datos, apps, idiomas…
├── apps.txt                # apps instaladas en este sitio
├── plugins/                # una copia del mundo de cada app
├── private/                # 0700: nada de esto se publica
│   ├── acme                # base de datos SQLite del sitio
│   └── files/              # adjuntos privados
└── public/files/           # ficheros públicos del sitio
```

La base SQLite de un sitio vive en `private/<nombre>`, no en la raíz del bench:
se mueve con el sitio, queda fuera del alcance público y `ferris site delete`
no deja un fichero huérfano. `site_config.json` guarda solo el nombre; la ruta
se resuelve al abrir la base.

Un sitio creado con un layout anterior (con la base en la raíz del bench) la
adopta automáticamente la primera vez que un comando lo abre: el fichero y sus
`-wal`/`-shm` se mueven a `private/` una sola vez y se registra en el log.

## Ejemplo completo

```bash
mkdir acme && cd acme
ferris init

ferris new billing                     # apps/billing/
ferris build --app billing

ferris site new acme.local \
  --db-type sqlite \
  --admin-email admin@acme.local \
  --admin-password "$ADMIN_PASSWORD"

cd sites/acme
ferris site install-app billing
ferris migrate
ferris serve --api --web --port 8000
```

Para servir todos los sitios a la vez, desde la raíz del bench:

```bash
ferris serve --all-sites
```

## Ver también

- [ferris new](/cli/new/): el scaffold de una app y el layout standalone.
- [Sitios](/configuracion/sites/): `site_config.json`, apps por sitio y el
  proceso por sitio.
- [ferris serve y run](/cli/serve-y-run/): roles, puertos y multi-sitio.
