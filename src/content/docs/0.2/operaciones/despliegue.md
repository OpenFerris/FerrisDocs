---
title: Despliegue
description: Targets de ferris deploy, Docker, Kubernetes, binario, proxy
  inverso, assets, migraciones y health.
slug: 0.2/operaciones/despliegue
---

Una app Ferris se compone de dos artefactos distintos: el **servidor** (el
binario `ferris`, que viene de una instalación de Ferris) y el **plugin** de la
app (`plugins/<app>.wasm`, que produce `ferris build`). `ferris deploy` despliega
el segundo; no construye el primero.

```bash
ferris deploy --target docker --env production --registry registry.example.com
ferris deploy --target kubernetes --env production
ferris deploy --target binary --env production --to /srv/ferris
```

| Flag | Por defecto | Qué hace |
|---|---|---|
| `--target` | `docker` | `docker`, `kubernetes`, `serverless` o `binary`. |
| `--env` | `production` | Etiqueta de imagen, namespace de k8s o nombre de directorio. |
| `--skip-build` | desactivado | No recompila el plugin antes de desplegar. |
| `--to` | — | Directorio de destino para `binary`. |
| `--registry` | — | Registro al que etiquetar y publicar la imagen. |

Salvo `--skip-build`, el comando compila el plugin en perfil `release` antes de
tocar el destino.

## `--target docker`

Requiere un `Dockerfile` en el directorio del proyecto. Ferris **no** genera uno:
la imagen necesita el binario del servidor y el plugin, y el CLI no puede
inventarse la procedencia del primero.

Con `--registry`, el comando ejecuta `docker build`, `docker tag` y
`docker push`. Sin `--registry` no ejecuta `docker build`: solo informa de la
etiqueta que habría usado, para no publicar una imagen que nadie pidió.

Un Dockerfile mínimo tiene esta forma:

```dockerfile
FROM rust:1.98.1 AS build
WORKDIR /src
COPY . .
RUN cargo build -p ferris-cli --release --features full

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/ferris /usr/local/bin/ferris
WORKDIR /srv/app
COPY config/ ./config/
COPY plugins/ ./plugins/
EXPOSE 8000
ENTRYPOINT ["ferris", "serve"]
```

El binario del ejemplo se compila contra la glibc de la imagen base. Usa la misma
imagen base para compilar y ejecutar, o un binario estático, para no mezclar
artefactos de libc distintas.

### Con Docker Compose

Una instalación pequeña cabe en un `compose.yaml`: la imagen del servidor, el
volumen de ficheros y el plugin montado. Migra antes de levantar el servicio.

```yaml
services:
  ferris:
    image: registry.example.com/ferris:production
    env_file: .env
    ports: ["8000:8000"]
    volumes: ["./config:/srv/app/config:ro", "./plugins:/srv/app/plugins",
              "ferris-files:/srv/app/files"]
    command: ["ferris", "serve"]

volumes:
  ferris-files:
```

```bash
docker compose run --rm ferris migrate
docker compose up -d
```

## `--target kubernetes`

Requiere `kubectl` en el `PATH` y un directorio `k8s/` con manifiestos.

```bash
kubectl apply -f k8s/ -n production
```

El comando no genera manifiestos ni crea el namespace. Un `k8s/` ausente es un
error, no un "deployment completado" optimista.

Puntos que un manifiesto debe resolver:

* **Un solo proceso con scheduler.** Dos réplicas con `scheduler` ejecutan el
  cron dos veces; separa `api,web` de `worker,scheduler`.
* **Migraciones como Job previo**, no en el `entrypoint` de cada réplica.
* **`external_url`** con el host público del Ingress, y secretos como `Secret`,
  no en el ConfigMap.
* **Persistencia** para SQLite, ficheros locales y `plugins/<app>/`. Con varias
  réplicas, usa PostgreSQL/MySQL y almacenamiento de objetos.

## `--target binary`

Copia el plugin y `config/` al destino. Por defecto `/opt/ferris/<env>`; `--to`
lo cambia (por ejemplo `--to /srv/ferris-staging`).

`--env` se convierte en un segmento de ruta, así que `../../etc` se rechaza. El
comando termina recordando que un plugin no es un programa: el servidor que lo
carga es el binario `ferris`. El destino acaba con `config/ferris.toml` y
`plugins/<app>.wasm`.

## `--target serverless`

No está implementado y falla explícitamente: no hay adaptador de proveedor ni
runtime serverless en Ferris.

## Servidor

El servidor se compila desde el workspace, no desde la app:

```bash
cargo build -p ferris-cli --release --features full
# o una build mínima coherente con [features]
cargo build -p ferris-cli --release --no-default-features --features api,web
```

```bash
./target/release/ferris --config /etc/ferris/ferris.toml migrate
./target/release/ferris --config /etc/ferris/ferris.toml serve
```

`ferris serve` arranca en primer plano y se detiene con `SIGINT`/`SIGTERM`; el
apagado es ordenado y espera a que terminen las peticiones en curso.

## Migraciones antes de servir

`ferris migrate` no se ejecuta solo. El orden correcto es:

```bash
ferris migrate --dry-run     # revisa lo pendiente
ferris migrate               # aplica tablas y customizaciones de plugins
ferris serve
```

En un despliegue con varias réplicas, migrate es un Job único que termina antes
de que las réplicas nuevas empiecen a recibir tráfico.

## Reverse proxy

Ferris puede terminar TLS él mismo o quedarse detrás de un proxy. Si el proxy
termina TLS, el proceso habla HTTP plano: `external_url` debe ser el origen
HTTPS público y las cookies de sesión no se marcan `Secure`.

Rutas que el proxy debe reenviar sin reescribir:

| Ruta | Notas |
|---|---|
| `/` y `/desk/*` | SSR del Desk. |
| `/api/*` | API REST, JSON-RPC, batch. |
| `/socket.io/*` | WebSocket; requiere upgrade y `Connection: Upgrade`. |
| `/events`, `/api/notifications/stream` | SSE; desactiva el buffering. |
| `/static/*`, `/pkg/*` | Assets; deja pasar las cabeceras del servidor. |
| `/plugins/*` | Rutas de apps WASM, incluidas descargas y assets. |

Los assets salen del mismo proceso; `ferris dev` los marca `no-store`.

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /socket.io/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

location /events {
    proxy_pass http://127.0.0.1:8000;
    proxy_buffering off;
}
```

Alinea `client_max_body_size` del proxy con `[server] body_limit_mb`: si el
proxy corta antes, el límite de Ferris nunca se ejerce y el error que ve el
usuario es el del proxy.

:::caution
`X-Forwarded-For` se registra tal cual en los logs de petición. No lo confíes
para autorizar: úsalo solo como procedencia informativa.
:::

## Health

```bash
curl -s http://127.0.0.1:8000/health
# {"status":"ok"}
```

`GET /health` no requiere sesión y responde mientras el proceso esté vivo. **No**
comprueba base de datos, Redis ni saturación: no es una readiness probe. Para
saber si el proceso puede servir de verdad, usa `ferris doctor` en el pipeline o
un chequeo propio contra la API.

## Variables de entorno en el contenedor

Las imprescindibles son `FERRIS_JWT_SECRET`, `FERRIS_SECRET_KEY`,
`FERRIS_SECRET_PREVIOUS_KEYS`, `DATABASE_URL`, `REDIS_URL`, `SERVER_HOST`,
`SERVER_PORT`, `FERRIS_TLS_CERT` y `FERRIS_TLS_KEY`. El resto se monta como
`config/ferris.toml` o se pasa con `--config`.
