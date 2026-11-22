---
title: MQTT
description: Un cliente nativo, nunca un broker — configuración, TLS/mTLS,
  suscripciones declaradas, límites y DLQ.
slug: 0.2/guias/mqtt
---

`ferris-mqtt` es un **cliente** MQTT. Nunca escucha conexiones ni hace de broker.
El servidor lo compila detrás del feature `mqtt`; un build sin él no contiene el
crate, así que no hay socket, ni rol, ni tareas.

## Tres interruptores, en orden

| Capa | Qué decide | Dónde |
|---|---|---|
| Cargo feature `mqtt` | el código existe | compilación del binario |
| `[features] mqtt` | el rol arranca | `ferris.toml` (por defecto **false**) |
| `[mqtt] enabled` | el operador pide el subsistema | `ferris.toml` |

`[mqtt] enabled = true` en un binario sin el feature es un **error de arranque**
cuyo mensaje dice recompilar con `--features mqtt`. No se ignora.

```toml
[server]
roles = ["api", "worker", "mqtt"]

[features]
mqtt = true

[mqtt]
enabled = true
queue = "default"
max_payload_bytes = 262144
max_inflight = 32
```

## Brokers

```toml
[[mqtt.brokers]]
id = "planta"
url = "mqtts://broker.example.com:8883"
client_id = "ferris-planta"
username = "ferris"
password = "…"
keepalive_secs = 60
clean_session = true
tls = true
ca_cert_path = "/etc/ferris/ca.pem"
client_cert_path = "/etc/ferris/client.pem"
client_key_path = "/etc/ferris/client.key"
```

| Campo | Nota |
|---|---|
| `id` | estable y único; es lo que las suscripciones nombran |
| `url` | `mqtt://`, `mqtts://`, `ws://` o `wss://` |
| `tls` | independiente del esquema; `mqtts://` ya implica TLS |
| `ca_cert_path`, `client_cert_path`, `client_key_path` | mTLS en PEM |

Reglas que el cliente rechaza al arrancar:

* `id` vacío o duplicado;
* `user:pass@` **dentro** de la URL: las credenciales van en sus campos, no en algo
  que cada log pueda imprimir;
* una suscripción que nombra un `broker` inexistente.

TLS es siempre **rustls** con el backend `ring`; no hay `native-tls` ni OpenSSL.

## Suscripciones del operador

```toml
[[mqtt.subscriptions]]
broker = "planta"
topic = "planta/+/temperatura"
qos = 1
job_type = "sensores.temperatura"
```

Destino: exactamente **uno** de `job_type` (se encola y llega a `handle-job`) o
`doctype` (el host inserta un documento). Ni los dos ni ninguno: es error de
configuración.

## Suscripciones declaradas por la app

```rust
mqtt_subscriptions: Some(vec![descriptor::MqttSubscription {
    broker: "planta".to_string(),
    topic: "planta/+/temperatura".to_string(),
    qos: types::MqttQos::AtLeastOnce,
    job_type: Some("sensores.temperatura".to_string()),
    destination: None,
}]),
```

Cada mensaje llega al guest con este cuerpo JSON:

```json
{
  "broker": "planta",
  "topic": "planta/linea1/temperatura",
  "payload": "…",
  "qos": 1,
  "retain": false
}
```

Una suscripción **no servible** (host sin `mqtt`, o broker que no existe) se
rechaza con una línea de log y **la app sigue cargando**. Un portátil sin broker
no debe perder la app entera. Declarar los dos destinos o ninguno sí es un error
de arranque del rol.

## Publicar y suscribirse desde el guest

```rust
use ferris::framework::{mqtt, platform, types};

let features = platform::features()?;
if !features.iter().any(|f| f == "mqtt") {
    return Err(types::Error::Internal("unsupported: mqtt".to_string()));
}

mqtt::publish(
    "planta",
    "planta/linea1/actuador",
    b"ON",
    types::MqttQos::AtLeastOnce,
    false,
)?;

let id = mqtt::subscribe("planta", "planta/+/estado", types::MqttQos::AtLeastOnce)?;
for sub in mqtt::list_subscriptions()? {
    println!("{} {} declarada={}", sub.id, sub.topic_filter, sub.declared);
}
mqtt::unsubscribe(&id)?;
```

`qos` es un enum cerrado (`at-most-once`, `at-least-once`, `exactly-once`), no un
número: el guest no puede enviar un valor sin significado.

:::danger[Comprueba la feature antes de llamar]
El host sin `mqtt` responde `internal` con el prefijo `unsupported: `. No es un
error de la petición y no se arregla reintentando. `platform::features()` es la
detección; `platform::grants()` es otra pregunta distinta (si la app tiene la
capacidad `mqtt`).
:::

## Dos puertas

1. **capacidad `mqtt`** — es egreso; sin ella, `permission-denied("mqtt")`;
2. **disponibilidad** — el host compiló el vertical.

Un broker que el host no configura es `not-found`; uno que la ACL de la app no
permite es `permission-denied`, nunca un no-op silencioso.

## Límites y DLQ

| Límite | Por defecto | Máximo |
|---|---|---|
| `max_payload_bytes` | 256 KiB | 64 MiB |
| `max_inflight` | 32 | 65 536 |
| reconexión | backoff exponencial acotado | — |

Nada se descarta en silencio. Una cola llena, un payload demasiado grande o un
sink que rechaza el mensaje van a la **DLQ**, cuya implementación por defecto
registra broker, suscripción, topic, qos, `retain`, tamaño y motivo — **nunca el
payload**, que es la parte más propensa a contener un token o datos personales.

El contador de la DLQ hace la pérdida observable sin parsear logs.

## DocTypes

| DocType | Para qué |
|---|---|
| `MQTT Broker` | definición del broker; la contraseña es un campo `Secret` |
| `MQTT Subscription` | suscripción administrada desde el Desk |
| `MQTT Message` | mensajes persistidos (cuando el destino es un DocType) |

## Checklist

* \[ ] El binario compiló `mqtt` (`ferris info`).
* \[ ] `[features] mqtt = true` y el rol `mqtt` en `[server] roles`.
* \[ ] Cada suscripción nombra un `broker` que existe.
* \[ ] Destino único: `job_type` **o** `doctype`.
* \[ ] TLS/mTLS: rutas PEM legibles por el proceso y CA correcta.
* \[ ] `job_type` declarado coincide con el que `handle-job` reconoce.
* \[ ] Hay un `worker` consumiendo la cola si el destino es un job.
