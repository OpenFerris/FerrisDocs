---
title: Observabilidad
description: Logs de tracing, registros de petición en DocTypes del sistema, endpoint de errores del cliente y diagnóstico con doctor e info.
---

Ferris observa un proceso desde cuatro sitios: los logs de `tracing`, las filas
que el servidor escribe en DocTypes del sistema, el endpoint que recoge errores
del navegador y los comandos de diagnóstico del CLI. No hay un sistema de
métricas separado.

## Logs de tracing

El CLI instala un subscriber de `tracing_subscriber` con este filtro:

```text
ferris=<nivel>,warn
```

- Sin `--verbose`, `ferris=info` y el resto en `warn`.
- Con `--verbose`, `ferris=debug`.
- La salida va a **stdout**, con el formato de texto por defecto de
  `tracing_subscriber`.

```bash
ferris serve            # info
ferris --verbose serve  # debug
```

:::note
El filtro es fijo: `RUST_LOG` no se lee en el arranque del CLI. Tampoco se leen
`[logging] level/format/output` ni `[telemetry]`: el modelo del núcleo los
declara, pero `ferris serve` construye ese bloque con los valores por defecto.
Para cambiar el nivel, usa `--verbose`; para recolectar, redirige stdout.
:::

En un contenedor o en systemd, stdout es el destino correcto: el supervisor ya
rota y envía. Un `[logging] file` no tendría efecto hoy.

## Registros de petición

Una capa externa al middleware de autenticación convierte cada petición
terminada en filas del sistema. Se ejecuta después de la respuesta, así que ve
el estado final, incluidos `404`, `504` y timeouts.

| DocType | Cuándo se escribe |
|---|---|
| `Path Log` | Toda petición registrable: método, ruta, estado, duración, usuario e IP. |
| `API Request Log` | Peticiones `/api/*` con procedencia externa al Desk. |
| `Error Log` | Respuestas `5xx`. |
| `View Log` | Apertura de un documento. |

Las escrituras son *fire-and-forget*: un fallo al registrar se anota en `debug`
y se descarta. Un log nunca debe tumbar la petición que describe.

La IP se toma del primer salto de `X-Forwarded-For`, luego de `X-Real-IP`; sin
proxy, queda vacía. No es un dato de autorización.

Para apagar los registros HTTP:

```bash
FERRIS_HTTP_LOG=0 ferris serve
```

Los assets de plugins (`/plugins/<app>/asset/…`) y los SSE abiertos se excluyen
para no llenar la tabla con ruido.

## Snapshots periódicos

Cada 300 segundos, un productor recorre los stores y escribe el modelo de
lectura del Desk:

- `Version`, una sola vez;
- `System Health Report` y `Database Storage Usage by Tables`;
- `RQ Job` / `RQ Worker` si la feature `jobs` está compilada;
- `Scheduled Job Type` / `Scheduled Job Log` si `scheduler`;
- `Prepared Report Analytics` si `report`.

Los stores siguen siendo la fuente de verdad; las tablas del sistema son la
proyección que se pinta en el Desk. Un mirror que falla se registra con `warn` y
el tick siguiente lo reintenta.

## Errores del cliente

El Desk no tiene una consola que el operador pueda leer. `POST /api/log/client`
convierte un error del navegador en una línea de log del servidor.

```bash
curl -X POST http://localhost:8000/api/log/client \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b cookies.txt \
  -d '{
    "level": "error",
    "message": "No se pudo guardar Invoice INV-0001",
    "context": "status=500 request_id=abc"
  }'
```

| Límite | Valor |
|---|---|
| Nivel aceptado | `warn` o `error`; cualquier otro es validación. |
| Mensaje | 2 KiB, una sola línea, truncado con marca. |
| Contexto | 4 KiB, una sola línea. |
| Autenticación | Obligatoria; un anónimo se rechaza antes de leer el cuerpo. |
| Efecto en base de datos | Ninguno. Es un sumidero de log, no un registro duradero. |
| Respuesta | No refleja el texto recibido. |

La línea se emite con `target: "ferris_client"`, así que un filtro
`target=ferris_client` aísla exactamente estos informes del resto del log.

## Diagnóstico con el CLI

### `ferris doctor`

Ejecuta una batería de checks y falla si alguno **crítico** está en rojo:

```bash
ferris doctor
```

| Check | Qué mira |
|---|---|
| `Rust toolchain` | `rustc` disponible y versión. |
| `Cargo` | `cargo` disponible. |
| `Cargo.toml` | Manifiesto del proyecto. |
| `Project structure` | `src/`, `config/`, manifiesto. |
| `Config files` | `config/ferris.toml` parseable. |
| `Feature matrix` | Lo configurado frente a lo compilado (crítico). |
| `Database configuration` | Tipo, SSL y conectividad. |
| `Redis` | Solo si `[realtime] enabled`; la cola cae a la base de datos. |
| `Secret fields` | Clave AEAD y filas cifradas con una clave anterior. |
| `Migrations` | Estado de las migraciones. |
| `WASM target` | `wasm32-wasip2` instalado. |

### `ferris info`

```bash
ferris info
```

Imprime versión, conjunto de features compilado, conjunto configurado,
discrepancias, toolchain, datos del proyecto y dependencias. Es la respuesta a
"¿por qué `serve` se niega a arrancar?" sin volver a lanzarlo.

### `ferris config show`

```bash
ferris config show | jq .server
```

JSON efectivo por stdout, con secretos redactados. El conjunto compilado se
imprime por **stderr**, para que el pipe siga siendo JSON válido.

## Health

```bash
curl -s http://localhost:8000/health
# {"status":"ok"}
```

Es un liveness probe: responde si el proceso está vivo. No consulta la base de
datos, Redis ni la cola. Para un readiness real, combina `/health` con una
llamada autenticada a la API o con `ferris doctor` en el pipeline.

## Lo que no hay

- **Sin métricas Prometheus**: no existe `/metrics` ni un exporter.
- **Sin trazas OTLP**: `[telemetry]` se declara en el modelo del núcleo, pero el
  servidor no lo cablea.
- **Sin logging a fichero con rotación**: stdout y el recolector del entorno.
- **Sin alertas ni retención automática**: Ferris escribe logs y filas; la
  alerta, la rotación y la purga son del sistema que los consume.

## Qué monitorizar de verdad

1. **`/health`** para liveness y reinicios.
2. **Tasa de `5xx`** en los logs o en `Error Log`.
3. **Latencia** en `Path Log`/`data.duration_ms`, por ruta.
4. **Crecimiento de `Path Log`**, de la cola (`RQ Job`, DLQ) y del disco.
5. **Scheduler**: última ejecución en `Scheduled Job Log`.

```sql
-- Ejemplo sobre PostgreSQL: rutas más lentas de la última hora.
-- Los campos del documento viven en la columna JSON `data`; solo name,
-- owner, docstatus, creation y modified son columnas propias.
SELECT data->>'path' AS ruta,
       avg((data->>'duration_ms')::int) AS media,
       max((data->>'duration_ms')::int) AS peor
FROM "tabPathLog"
WHERE creation > extract(epoch FROM now()) - 3600
GROUP BY 1
ORDER BY peor DESC
LIMIT 20;
```

Los nombres físicos de tabla son `tab` + el DocType sin espacios: `Path Log` →
`"tabPathLog"`, `System Health Report` → `"tabSystemHealthReport"`. El motor
cita el identificador, así que en PostgreSQL necesitas las comillas por la
mayúscula; ajústalo a tu dialecto. `creation` es un entero de segundos Unix; los
campos del documento, en cambio, viven dentro de la columna JSON `data`.
