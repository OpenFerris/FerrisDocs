---
title: Trabajos y scheduler
description: Cola Redis, cron, handle-job y el ciclo de reintentos con dead-letter, desde una app WASM.
---

Ferris separa dos cosas que suelen confundirse:

- **scheduler**: decide *cuándo* se encola algo (expresiones cron);
- **jobs**: la cola que ejecuta el trabajo, con reintentos y dead-letter.

Ambos necesitan el rol correspondiente y Redis.

## Roles y configuración

```toml
[server]
roles = ["api", "web", "worker", "scheduler"]

[jobs]
enabled = true
default_queue = "default"
worker_concurrency = 4
poll_interval_ms = 500
retry_backoff_base_secs = 60
dead_letter_queue = "dead_letter"

[scheduler]
enabled = true
timezone = "UTC"
```

| Rol | Qué arranca |
|---|---|
| `worker` | consume la cola y despacha cada job |
| `scheduler` | carga los schedules persistidos y encola según el cron |

Un proceso `api` sin `worker` acepta `enqueue-job` y **no ejecuta nada**. Es una
configuración válida: la cola es compartida, otro proceso puede consumirla.

:::caution[Redis es opcional, la cola no]
La cola usa Redis para el reparto y el estado en SQL. Si Redis no está
configurado o no responde, el servidor **cae a una cola respaldada por la base de
datos** y lo registra con un `warn`: el trabajo sigue ejecutándose, más lento. Lo
que nunca ocurre es ejecutar el job en línea dentro de la petición.
:::

## Encolar desde la app

```rust
use ferris::framework::platform;

platform::enqueue_job(
    "notas.reindexar",
    r#"{"desde":"2026-11-01"}"#,
)?;
```

`job-type` es una cadena libre que la app elige; el worker la reenvía a
`handle-job` tal cual. El payload es un JSON que la app interpreta.

## Programar con cron

```rust
let id = platform::schedule(
    r#"{"cron":"0 3 * * *","job_name":"notas.reindexar","queue":"default",
        "payload":{"desde":"ayer"}}"#,
)?;
```

Campos del payload:

| Campo | Obligatorio | Nota |
|---|---|---|
| `cron` | sí | cinco campos; vacío es un error de validación |
| `job_name` | no | por defecto `scheduled_job`; es el `job-type` que recibe el guest |
| `queue` | no | cola destino |
| `payload` | no | se conserva y se entrega al job |
| `priority` | no | se parsea si el scheduler la conoce |
| `tags` | no | se preservan; el host añade el tag de propiedad de la app |

El host etiqueta el schedule con la app que lo creó, así que `list-schedules` y
`cancel-schedule` solo ven los suyos. Cancelar un id de otra app es
`permission-denied`; cancelar uno ya inexistente es un éxito (idempotente).

```rust
for s in platform::list_schedules()? {
    println!("{} {} {} activo={}", s.id, s.job_name, s.cron, s.enabled);
}
platform::cancel_schedule(&id)?;
```

## Recibir el trabajo

```rust
fn handle_job(job_type: String, payload: String) -> Result<String, Error> {
    if job_type == "notas.reindexar" {
        let args: serde_json::Value = serde_json::from_str(&payload)
            .map_err(|e| types::Error::ValidationFailed(e.to_string()))?;
        let n = reindexar(&args).map_err(|e| types::Error::Internal(e.to_string()))?;
        // El string devuelto es el resultado del job.
        return Ok(format!("{n} notas"));
    }
    Err(types::Error::NotFound(format!("job desconocido: {job_type}")))
}
```

El worker del servidor instala un despachador con dos niveles:

1. handlers exactos (por ejemplo, los del runtime de integraciones);
2. **fallback** al `handle-job` de la app cargada.

Un job reclamado que ningún handler reconoce **falla ruidosamente**: reintenta y
acaba en dead-letter. No se descarta en silencio.

:::note[Un solo job a la vez por app]
La app tiene una única instancia `wasmtime`. Dos jobs de la misma app se
serializan en su store. Si necesitas paralelismo, reparte en varias apps o
devuelve rápido y encola el siguiente paso.
:::

## Reintentos y dead-letter

```text
intento 1 → falla → espera backoff → intento 2 → … → max_retries → dead_letter
```

- el número de reintentos es del **job** (`max_retries`), no de la cola;
- la espera es exponencial con base `retry_backoff_base_secs`;
- al agotarse, el job pasa a `status = dead_letter` y se mueve a
  `dead_letter_queue`, de modo que la cola de origen no queda con un backlog
  fantasma;
- un job dead-letter **nunca se reclama**.

## Buenos patrones

- **Idempotencia**: un reintento puede repetir el trabajo. Usa `upsert` o una
  clave natural en lugar de `create` ciego.
- **Payloads pequeños**: el payload viaja por Redis y se guarda; no metas un
  fichero, guarda la ruta en `/world` o el `name` de un documento.
- **Presupuesto de CPU**: cada llamada al guest tiene un deadline. Un trabajo
  largo debe partirse en varios jobs.
- **Errores tipados**: devuelve `validation-failed` para datos malos (no
  reintentable en la práctica) e `internal` para fallos transitorios.

## Límites conocidos

| Límite | Valor |
|---|---|
| instancias concurrentes por app | 1 |
| cola | Redis con fallback a la base de datos |
| cron | expresión de cinco campos, normalizada por el host |
| alcance de los schedules | por instalación, con tag de propiedad por app |
| plazo por llamada al guest | finito (epoch del runtime) |

## Comprobarlo

```bash
ferris doctor                       # Redis, config, matriz de features
ferris info                         # ¿está `jobs`/`scheduler` compilado?

curl -s -b cookies.txt localhost:8000/plugins/mi-app | jq '.config'
```

Si un `job_name` programado no ejecuta nada: comprueba que el rol `worker` está
en `[server] roles`, que Redis responde y que `handle-job` reconoce el
`job-type` exacto (es una comparación de cadenas, no un patrón).
