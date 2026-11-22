---
title: Inicio rápido
description: Crea un proyecto con ferris new, migra el esquema, arranca el servidor en Docker y entra al Desk.
---

Esta página recorre el camino mínimo: un proyecto nuevo, su configuración, la
migración y el primer login en el Desk. Todos los comandos se ejecutan dentro
del servicio `ferris` de `compose.yaml`, que monta el repositorio en
`/workspace`. Si aún no tienes la imagen, empieza por
[instalación](/getting-started/instalacion/).

## 1. Crear el proyecto

```bash
docker compose run --rm ferris cargo run -p ferris-cli -- new my-app
```

El directorio se crea en el host como `my-app/`, porque `/workspace` es un bind
mount. La primera invocación compila la CLI y su grafo de dependencias, así que
puede tardar varios minutos.

`ferris new` es atómico: si un paso falla, borra lo que había creado.
Rechaza nombres que no empiecen por letra ASCII o que contengan algo distinto de
letras, dígitos, `-` y `_`, y falla si el destino ya existe.

Puedes elegir la ubicación con `--into`:

```bash
docker compose run --rm ferris \
  cargo run -p ferris-cli -- new billing --into apps/billing
```

El scaffold contiene `src/lib.rs` (el componente WIT), `wit/ferris.wit` (copia
del contrato del framework), `config/ferris.toml`, `.cargo/config.toml`,
`rust-toolchain.toml`, `Cargo.toml`, `.gitignore` y `README.md`, y hace
`git init`. El detalle está en
[estructura del proyecto](/getting-started/estructura-proyecto/).

## 2. Compilar la CLI una vez

El proyecto creado es un componente WASM independiente: **no** incluye la CLI
del framework. Para ejecutar `ferris` dentro de `my-app`, deja el binario en el
`target/` del repositorio:

```bash
docker compose run --rm ferris cargo build -p ferris-cli --release
```

El artefacto queda en `/workspace/target/release/ferris`, visible también en el
host. A partir de aquí se invoca por ruta absoluta, porque el directorio de
trabajo será el del proyecto. También puedes abrir una shell y trabajar dentro:

```bash
docker compose run --rm ferris bash
cd /workspace/my-app
/workspace/target/release/ferris doctor
```

## 3. Revisar `config/ferris.toml`

El scaffold escribe una configuración de desarrollo con SQLite, para que el
servidor arranque sin base de datos externa:

```toml
# my-app — Ferris configuration (dev)
[database]
type = "sqlite"
name = "my-app.db"
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

Para usar PostgreSQL, cambia el bloque y arranca el servicio:

```toml
[database]
type = "postgres"
name = "ferris"
host = "postgres"
port = 5432
user = "ferris"
password = "ferris"
max_connections = 10
ssl_mode = "disable"
```

`host = "postgres"` funciona porque ambos contenedores comparten la red de
Compose. No uses `localhost` ahí: dentro del contenedor `ferris`, `localhost` es
el propio contenedor. Desde el host, PostgreSQL escucha en `localhost:5432`.

## 4. Migrar

```bash
docker compose run --rm --workdir /workspace/my-app \
  ferris /workspace/target/release/ferris migrate
```

Aplica las migraciones de esquema del framework contra la base configurada, en
proceso. Para ver qué haría antes de aplicarlo:

```bash
docker compose run --rm --workdir /workspace/my-app \
  ferris /workspace/target/release/ferris migrate --dry-run
```

`migrate` también aplica las personalizaciones exportadas de cada app habilitada
(`plugins/<app>/customizations/*.json`). Es el único comando que lo hace:
`serve` no las reaplica, para que una edición hecha en el Desk después del
último export no se revierta al reiniciar.

## 5. Arrancar

`ferris dev` levanta los roles `api`, `web` y `realtime` en un solo puerto y
recarga el plugin cuando cambian sus fuentes. Necesita **publicar** el puerto en
el host: `--service-ports` aplica los mapeos de `compose.yaml` (`8000` y `4321`).

```bash
docker compose run --rm --service-ports --workdir /workspace/my-app \
  ferris /workspace/target/release/ferris dev
```

La primera ejecución compila el componente para `wasm32-wasip2`; si faltan
dependencias en la caché de Cargo, necesita red. `Ctrl+C` detiene el servidor.

Si ya tienes un contenedor de desarrollo levantado con `docker compose up -d
ferris`, puedes entrar por `docker compose exec` en lugar de crear otro:

```bash
docker compose exec ferris bash
cd /workspace/my-app
/workspace/target/release/ferris dev
```

:::caution[Los puertos se publican una sola vez]
Dos procesos no pueden escuchar el mismo puerto del host. Si el sitio de
documentación está usando `4321`, el arranque fallará; para el otro proceso o
publica solo `8000` con `-p 8000:8000`.
:::

## 6. Iniciar sesión

`ferris dev` crea, si la tabla de usuarios está vacía, la cuenta:

```text
email:    admin@local
password: ferrisAdmin123
rol:      System Manager
```

La contraseña se imprime en el log del arranque y la siembra es idempotente: si
ya existe un usuario, no toca nada. **Es una credencial de desarrollo**;
cámbiala en cuanto salgas del entorno local.

Abre:

- Desk: `http://localhost:8000/desk`
- Login: `http://localhost:8000/login`
- Salud del proceso: `http://localhost:8000/health`

El login es un `POST /api/auth/login` con `{"username": "...", "password":
"..."}` que abre una sesión en cookie y devuelve el token CSRF en la cabecera
`X-CSRF-Token`. El Desk lo hace por ti; si vas a llamar a la API a mano, lee
[autenticación](/api/autenticacion/).

:::danger[`ferris serve` no siembra usuarios]
La cuenta `admin@local` la crea `ferris dev`, no `serve`. Un `serve` sobre una
base de datos vacía no tiene con qué iniciar sesión. Siembra en desarrollo (o
crea el usuario por la vía que uses en tu despliegue) antes de esperar un login.
:::

Si prefieres el servidor sin recarga:

```bash
docker compose run --rm --service-ports --workdir /workspace/my-app \
  ferris /workspace/target/release/ferris serve --all
```

## 7. Comprobar la instalación

Con el servidor parado o en otra terminal:

```bash
docker compose run --rm --workdir /workspace/my-app \
  ferris /workspace/target/release/ferris doctor
```

`doctor` valida toolchain, estructura, configuración, matriz de features, base de
datos, Redis, secretos, migraciones y target wasm. Un fallo crítico devuelve
código de salida distinto de cero, así que sirve en CI.

## 8. Siguiente paso

El scaffold ya declara un DocType `Task` con tres campos (`subject`, `status`,
`due_date`) dentro de `describe()`. Para entenderlo y para declarar el tuyo:

→ [Tu primer DocType](/getting-started/primer-doctype/)

:::tip[Qué mirar si algo falla]
- `no roles selected` → pasa `--all` o al menos un flag de rol a `serve`.
- `invalid config value for [features]` → tu binario no compila ese subsistema;
  reconstruye con la feature o apaga el gate.
- `Project structure` o `Config files` en rojo → `doctor` exige `src/`,
  `config/` y `Cargo.toml`; `migrate` exige `Cargo.toml` y lee la configuración
  del directorio actual.
- La página no carga en `localhost:8000` → el contenedor no publicó el puerto;
  repite el arranque con `--service-ports` o `-p 8000:8000`.
:::
