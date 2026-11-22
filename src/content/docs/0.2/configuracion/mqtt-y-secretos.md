---
title: MQTT y secretos
description: Cliente MQTT nativo, brokers, suscripciones, DLQ y el cifrado
  recuperable de los campos Secret.
slug: 0.2/configuracion/mqtt-y-secretos
---

Dos mecanismos que suelen confundirse viven en esta página: el **cliente
MQTT**, que conecta Ferris con brokers externos, y los **campos `Secret`**, que
guardan credenciales cifradas y recuperables dentro de la base de datos.

## Sección `[mqtt]`

```toml
[mqtt]
enabled = true
queue = "default"
max_payload_bytes = 262144
max_inflight = 32
```

| Clave | Por defecto | Qué hace |
|---|---|---|
| `enabled` | `false` | Arranca el rol MQTT. Es una **petición**, no solo un permiso. |
| `queue` | `""` | Cola donde encolar los mensajes; vacío usa la cola por defecto. |
| `max_payload_bytes` | `262144` | Techo de un payload; se aplica antes de encolar. |
| `max_inflight` | `32` | Mensajes sin confirmar por conexión. |
| `brokers` | `[]` | Conexiones declaradas. |
| `subscriptions` | `[]` | Filtros de tema y su destino. |

`[mqtt]` es plano y no depende de `ferris-mqtt`: el núcleo transporta los
registros y el cliente nativo los convierte en su propia configuración.

### Brokers

```toml
[[mqtt.brokers]]
id = "plant"
url = "mqtts://broker.example.com:8883"
client_id = "ferris-erp"
username = "ferris"
password = "..."
keepalive_secs = 60
clean_session = true
tls = true
ca_cert_path = "/etc/ferris/mqtt/ca.pem"
client_cert_path = "/etc/ferris/mqtt/client.pem"
client_key_path = "/etc/ferris/mqtt/client.key"
```

| Clave | Notas |
|---|---|
| `id` | Identificador estable al que apuntan las suscripciones. |
| `url` | `mqtt://`, `mqtts://`, `ws://` o `wss://`, con host y puerto. |
| `client_id` | Opcional; el broker puede asignarlo. |
| `username`, `password` | Credenciales de conexión. |
| `keepalive_secs` | Latido; 60 por defecto. |
| `clean_session` | `true` por defecto. |
| `tls` | Fuerza TLS aunque el esquema no lo implique. |
| `ca_cert_path` | CA del broker para verificar su certificado. |
| `client_cert_path`, `client_key_path` | Material de cliente para mTLS. |

`mqtts://` implica TLS; el flag `tls` permite activarlo con un esquema que no lo
expresa. La verificación del certificado es la política por defecto: no hay un
interruptor para desactivarla en esta sección.

### Suscripciones

```toml
[[mqtt.subscriptions]]
broker = "plant"
topic = "plant/+/temperature"
qos = 1
enabled = true
job_type = "ingest_temperature"
```

Cada suscripción tiene **exactamente un** destino:

* `job_type`: encola el mensaje como trabajo; lo recibe el `handle-job` de la app.
* `doctype`: inserta el mensaje en un DocType declarado.

Ni los dos ni ninguno: el cliente rechaza la configuración al arrancar y nombra
la fila culpable. Tampoco se aceptan un `broker` desconocido ni dos brokers con
el mismo `id`.

### Feature, rol y arranque

`mqtt` es la única vertical que **no** está en la build por defecto:
`cargo build -p ferris-cli --release --features mqtt`.

La diferencia importa: `[features] mqtt = true` es un **permiso** y, en un
binario sin la feature, el rol simplemente no arranca; `[mqtt] enabled = true`
—o declarar un broker o una suscripción— es una **petición** y falla al arrancar
con la instrucción de recompilar. El rol se pide con `roles = ["mqtt"]` o
`--all`.

### Entrega y DLQ

El host posee el socket; una app WASM usa la interfaz `mqtt` y comprueba
`platform::features()` antes de mostrar controles. Si la feature no está, el
host responde `unsupported`; la interfaz sigue declarada porque WIT es un
contrato estático.

Un mensaje que no se puede entregar **no se descarta**: un payload por encima
de `max_payload_bytes`, una cola de despacho llena o un destino que rechaza el
mensaje van a la DLQ con el motivo. La DLQ es la cola `dead_letter` de
`[jobs]`; consúltala antes de asumir que un mensaje se perdió.

:::note
El cliente es nativo (`rumqttc` sobre rustls), no un broker. Ferris no acepta
conexiones MQTT entrantes; se conecta a un broker como cualquier otro cliente.
:::

## Secretos recuperables

`[secrets]` instala la clave que cifra los campos de tipo `Secret`.

```toml
[secrets]
key = "64-caracteres-hex-o-base64-de-32-bytes"
previous_keys = []
```

| Clave | Notas |
|---|---|
| `key` | 32 bytes en 64 hex o base64 (URL-safe o estándar, con o sin padding). |
| `previous_keys` | Claves anteriores, aceptadas solo para descifrar. |

También se aceptan `FERRIS_SECRET_KEY` (o `FERRIS_SECRETS__KEY`) para la clave y
`FERRIS_SECRET_PREVIOUS_KEYS="clave-anterior-1,clave-anterior-2"` para las
anteriores.

### Cómo se guarda

AES-256-GCM con un nonce aleatorio de 96 bits por valor. El texto guardado es
un sobre versionado:

```text
ferris:v1:<key-id>:<payload-base64url>
```

El `key-id` son los primeros 8 caracteres hex de `SHA-256(clave)`. El DocType y
el nombre del campo se usan como **datos asociados**: copiar un cifrado a otro
campo o a otro DocType falla la autenticación en vez de descifrar en el sitio
equivocado.

Guardar dos veces el mismo secreto produce dos cifrados distintos. El nonce nunca
se reutiliza.

### `Password` frente a `Secret`

| Tipo de campo | Almacenamiento | Lectura normal |
|---|---|---|
| `Password` | Hash Argon2, unidireccional | `********` |
| `Secret` | AES-256-GCM, recuperable | `********` |

Un `Password` sirve para verificar un login: nunca devuelve el plaintext. Un
`Secret` sirve para un `client_secret` de OAuth, una clave de webhook o una
contraseña SMTP, donde el conector necesita el valor real para firmar o
autenticarse. Declarar esos campos como `Password` hace que toda integración lea
`"********"` y falle en silencio.

El plaintext de un `Secret` solo se entrega a un contexto de motor que llamó a
`reveal_secrets()`, y viaja envuelto en `SecretValue`, sin `Display` ni
`Serialize` y con `Debug` redactado.

### Rotación

1. Genera una clave nueva.
2. Ponla en `key` y mueve la anterior a `previous_keys`.
3. Arranca: los valores nuevos se cifran con la nueva; los anteriores se descifran
   con la que sigue instalada.
4. Reescribe las filas (guardar cada documento basta) y quita la clave anterior
   de `previous_keys`.

Un valor cuyo `key-id` ya no está instalado devuelve `UnknownKeyId`. Un valor
que no es un sobre v1 (por ejemplo, un hash Argon2 escrito cuando el campo era
`Password`) devuelve `NotRecoverable`. Ninguno se convierte en cadena vacía.

:::danger
Sin la clave, los campos `Secret` **no se pueden recuperar**. Guarda la clave
fuera del backup de la base de datos y del repositorio, y conserva las anteriores
mientras quede una sola fila sin reescribir.
:::

### Arranque y diagnóstico

* Una clave **malformada** es fatal: se detiene el arranque, porque nada escrito
  en esa ejecución podría descifrarse después.
* Una clave **ausente** no impide servir: se registra un aviso si el catálogo
  declara campos `Secret`; la primera escritura o revelación falla con
  `KeyMissing`.
* `ferris doctor` comprueba la clave y escanea el blob almacenado en busca de
  campos `Secret` que aún no sean un sobre cifrado.

`ferris config show` imprime la clave como `<redacted>`, igual que las
contraseñas de broker y los secretos de proveedor, que también se enmascaran en
`Debug` y en `ferris info`.
