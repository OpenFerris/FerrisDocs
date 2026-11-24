---
title: Inicio rápido
description: Crea un bench con ferris new, arranca la app con ferris dev, publica el paquete y sirve un sitio con ferris serve --site.
---

Esta página recorre el camino mínimo: un bench nuevo, su app, la migración, el
primer login y un sitio que sirve esa app. Todos los comandos se ejecutan dentro
del servicio `ferris` de `compose.yaml`, que monta el repositorio en
`/workspace`. Si aún no tienes la imagen, empieza por
[instalación](/getting-started/instalacion/).

## 1. Compila la CLI una vez

```bash
docker compose run --rm ferris cargo build -p ferris-cli --release
```

El artefacto queda en `/workspace/target/release/ferris`, visible también en el
host. La CLI no se instala dentro de cada app: se invoca por ruta absoluta desde
el directorio del bench. La primera compilación tarda varios minutos.

## 2. Inicializa el bench y crea la app

El directorio de trabajo **es** el bench. Primero `ferris init` crea la
estructura en una carpeta existente (configuración, `apps/`, `sites/`), y
después `ferris new` añade la app bajo `apps/`:

```bash
mkdir -p bench
docker compose run --rm --workdir /workspace/bench \
  ferris /workspace/target/release/ferris init
docker compose run --rm --workdir /workspace/bench \
  ferris /workspace/target/release/ferris new billing
```

```text
bench/
├── config/ferris.toml     # una sola configuración para apps y sitios
├── apps/
│   └── billing/           # el crate WIT/WASM
└── sites/
    └── common_site_config.json
```

`ferris init` no borra nada y se niega a ejecutarse si ya hay un bench. `ferris
new` es atómico: si un paso falla, borra lo que había creado. Rechaza nombres
que no empiecen por letra ASCII o que contengan algo distinto de letras,
dígitos, `-` y `_`, y falla si el destino ya existe. Si necesitas una app
autocontenida fuera de un bench (`./billing/` con su propia configuración), usa
`ferris new billing --standalone`; lo explica [ferris new](/cli/new/).

Los comandos disponibles dependen de dónde estés: la raíz del bench, un sitio o
una app. [ferris init y contexto](/cli/init-y-contexto/) lo resume en una tabla.

## 3. Revisa `config/ferris.toml`

```toml
[database]
type = "sqlite"
name = "ferris.db"
# …

[server]
host = "127.0.0.1"
port = 8000
roles = ["api", "web", "realtime"]

[apps]
wasm_dir = "apps"        # el catálogo global
enabled = []

[i18n]
default_locale = "en"
supported = ["en", "es"]
```

`wasm_dir = "apps"` es lo que hace del bench un catálogo: `ferris build` publica
el paquete en `apps/<app>/` y `ferris site install-app` lo copia a un sitio. Para
PostgreSQL, cambia el bloque y arranca el servicio `postgres`; `host = "postgres"`
funciona porque ambos contenedores comparten la red de Compose.

## 4. Migra

```bash
docker compose run --rm --workdir /workspace/bench \
  ferris /workspace/target/release/ferris migrate
```

Aplica las migraciones del framework contra `ferris.db` y las customizaciones
que cada app habilitada exporta en su mundo. Para verlo antes de aplicarlo:

```bash
docker compose run --rm --workdir /workspace/bench \
  ferris /workspace/target/release/ferris migrate --dry-run
```

## 5. Arranca en desarrollo

Desde la raíz del bench, con `--app`:

```bash
docker compose run --rm --service-ports --workdir /workspace/bench \
  ferris /workspace/target/release/ferris dev --app billing
```

Con una sola app bajo `apps/` el flag es opcional; con varias es obligatorio (o
entras en `apps/<app>/` y ejecutas `ferris dev` allí). El comando compila a
`wasm32-wasip2`, sirve API, Desk y realtime en el puerto 8000 y recarga la app al
cambiar sus fuentes. `--service-ports` publica `8000` y `4321` en el host.

La primera ejecución necesita red si faltan dependencias en la caché de Cargo.
`Ctrl+C` detiene el servidor.

## 6. Inicia sesión

`ferris dev` crea, si la tabla de usuarios está vacía, la cuenta:

```text
email:    admin@local
password: ferrisAdmin123
rol:      System Manager
```

La siembra es idempotente y **es una credencial de desarrollo**: cámbiala en
cuanto salgas del entorno local. Abre:

- Desk: `http://localhost:8000/desk`
- Login: `http://localhost:8000/login`
- Salud: `http://localhost:8000/health`
- Descriptor de la app: `http://localhost:8000/plugins/billing`

El login es un `POST /api/auth/login` que abre una sesión en cookie y devuelve el
token CSRF en `X-CSRF-Token`. El Desk lo hace por ti; para llamar a la API a
mano, lee [autenticación](/api/autenticacion/).

## 7. Publica y sirve un sitio

El build escribe dos artefactos: el componente plano en
`apps/billing/plugins/billing.wasm` y el **paquete de catálogo** en
`apps/billing/billing.wasm` con `plugin.toml`, `world/` y `assets/`.

```bash
ferris build --app billing
```

Un sitio recibe una **copia** del paquete y fija su versión en
`site_config.json`; reemplazar el catálogo no cambia lo que sirve un sitio ya
instalado.

```bash
docker compose run --rm --service-ports --workdir /workspace/bench \
  ferris bash
```

Dentro del contenedor, en la raíz del bench:

```bash
export FERRIS=/workspace/target/release/ferris
export FERRIS_ADMIN_PASSWORD='cambia-esta-clave'
export FERRIS_JWT_SECRET="$(openssl rand -hex 32)"

$FERRIS build --app billing
$FERRIS site new acme --host acme.localhost --db-type sqlite \
  --admin-email admin@acme.local
$FERRIS site install-app billing --site acme
$FERRIS site migrate acme
$FERRIS site info acme               # incluye versions: billing=0.1.0
$FERRIS serve --site acme            # sin flags de rol: usa [server] roles
```

Entra en `http://acme.localhost:8000/desk` con `admin@acme.local` y la contraseña
que exportaste. Un `Host` distinto recibe `421 Misdirected Request`.

Para servir todos los sitios habilitados desde un solo puerto y despachar por
`Host`:

```bash
$FERRIS serve --all-sites --port 8000
```

Los límites de ese despachador (TLS delante, HTTP/1.1 y WebSocket) están en
[ferris serve y run](/cli/serve-y-run/).

## 8. Comprueba la instalación

Con el servidor parado o en otra terminal:

```bash
docker compose run --rm --workdir /workspace/bench \
  ferris /workspace/target/release/ferris doctor
```

`doctor` valida toolchain, layout del bench o de la app, configuración, matriz de
features, base de datos, Redis, secretos, migraciones, target wasm y, dentro de
una app, que `wit/ferris.wit` coincide con la versión del host. Un fallo crítico
devuelve código distinto de cero, así que sirve en CI.

## 9. Siguiente paso

El scaffold declara un DocType `Task` con tres campos (`subject`, `status`,
`due_date`) dentro de `describe()`. Para entenderlo y declarar el tuyo:

→ [Tu primer DocType](/getting-started/primer-doctype/)

:::tip[Qué mirar si algo falla]
- `no roles selected` → el fichero no define `[server] roles` y no pasaste
  ningún flag de rol.
- `invalid config value for [features]` → tu binario no compila ese subsistema;
  reconstruye con la feature o apaga el gate.
- `Project structure` o `WIT version` en rojo → `doctor` exige `apps/` + `sites/`
  en la raíz del bench, o `src/` + `wit/ferris.wit` dentro de la app.
- La página no carga en `localhost:8000` → el contenedor no publicó el puerto;
  repite el arranque con `--service-ports` o `-p 8000:8000`.
:::
