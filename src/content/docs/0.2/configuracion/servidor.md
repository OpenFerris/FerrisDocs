---
title: Servidor
description: "Referencia de [server] en ferris.toml: listener, roles, límites,
  CORS, TLS, mTLS, PKI y URL pública."
slug: 0.2/configuracion/servidor
---

La sección `[server]` decide en qué dirección escucha Ferris, qué roles sirve,
cuánto acepta por petición y cómo se presenta ante un proxy o un proveedor
OAuth.

```toml
[server]
host = "0.0.0.0"
port = 8000
workers = 4
request_timeout_secs = 60
body_limit_mb = 50
roles = ["api", "web", "realtime"]
enable_cors = false
cors_origins = []
external_url = "https://erp.example.com"
```

## Campos

| Clave | Tipo | Por defecto | Qué hace |
|---|---|---|---|
| `host` | string | `"0.0.0.0"` | Dirección de bind del listener HTTP/HTTPS. |
| `port` | u16 | `8000` | Puerto del listener. |
| `workers` | usize | núcleos disponibles | Se acepta en la configuración; hoy no fija los hilos de Tokio. |
| `request_timeout_secs` | u64 | `60` | Timeout global de petición; al vencer responde `504`. |
| `body_limit_mb` | usize | `50` | Tamaño máximo del cuerpo, en MiB. |
| `roles` | array | `["all"]` | Roles que arranca el proceso. |
| `enable_cors` | bool | `false` | Activa la capa CORS. |
| `cors_origins` | array | `[]` | Lista blanca explícita de orígenes. |
| `external_url` | string | sin definir | Origen público para URLs absolutas. |
| `[server.tls]` | tabla | sin definir | TLS/mTLS terminado en el proceso. |
| `[server.pki]` | tabla | sin definir | CA interna que firma CSRs de dispositivos. |

:::note
`workers` se acepta en la configuración, pero `ferris serve` crea el runtime de
Tokio con `new_multi_thread()` sin `worker_threads`: el número de hilos lo decide
Tokio, no este campo.
:::

## Roles

Los valores válidos son `api`, `web`, `realtime`, `worker`, `scheduler`, `mqtt`
y `all`. Un nombre desconocido es un error de arranque, incluso si también está
`all`, para que una errata no quede enmascarada.

| Rol | Qué monta |
|---|---|
| `api` | `/api/*`, sesiones públicas, OAuth, `/health`. Es la base de toda build. |
| `web` | `/static/*`, `/pkg/*` y el árbol SSR del Desk. |
| `realtime` | Socket.IO en `/socket.io` sobre el mismo listener. |
| `worker` | Consumidor de la cola de trabajos (`jobs`). |
| `scheduler` | Cron y trabajos programados. |
| `mqtt` | Cliente MQTT nativo; requiere `features.mqtt` y `[mqtt] enabled`. |

`--all` y `roles = ["all"]` piden todos, pero `[features]` y las features de
Cargo siguen mandando: un rol desactivado no arranca, y el log dice si fue por
un flag de configuración o por una feature no compilada.

```bash
ferris serve --all
ferris serve --api --web
```

## CORS

CORS está apagado por defecto. Al activarlo, **solo** se aceptan los orígenes
de `cors_origins`; no existe modo comodín.

```toml
[server]
enable_cors = true
cors_origins = ["https://app.example.com", "https://admin.example.com"]
```

Una entrada `"*"` se rechaza con un aviso y no se aplica. La capa permite
credenciales (la sesión viaja en cookie), y por eso la lista explícita es
obligatoria. También expone `X-CSRF-Token`, que el Desk devuelve en cada
mutación autenticada por cookie.

```bash
ferris serve --cors-origin https://app.example.com
```

## TLS y mTLS

Con `[server.tls]`, Ferris termina TLS en el proceso. Sin esa tabla sirve HTTP
plano, que es el modo de desarrollo.

```toml
[server.tls]
cert_path = "/etc/ferris/tls/fullchain.pem"
key_path = "/etc/ferris/tls/privkey.pem"
min_version = "1.2"
```

| Clave | Significado |
|---|---|
| `cert_path` | Cadena PEM del servidor, hoja primero. |
| `key_path` | Clave PEM (PKCS#8, PKCS#1 o SEC1). |
| `min_version` | `"1.2"` (por defecto) o `"1.3"`. Cualquier otro valor falla. |
| `client_ca_path` | CA(s) que firman certificados de cliente; habilita mTLS. |
| `require_client_cert` | Exige un certificado de cliente verificado. |

`require_client_cert = true` sin `client_ca_path` es un error de arranque: un
servidor que dice exigir identidad y no tiene contra qué verificarla no debe
levantarse. Con `client_ca_path` y sin exigencia, el certificado se solicita y,
si es válido, se adjunta a la petición; sin él, el cliente sigue siendo anónimo.

Los certificados de cliente se aceptan como credencial para `/api/method/*`;
no sustituyen a un rol de sesión en `/api/resource/*`.

### Variables planas

En contenedores suele ser más cómodo inyectar rutas que tablas:
`FERRIS_TLS_CERT`, `FERRIS_TLS_KEY`, `FERRIS_MTLS_CLIENT_CA`,
`FERRIS_MTLS_REQUIRE` y `FERRIS_TLS_MIN_VERSION`. Definir solo una de las dos
rutas de certificado no desactiva TLS: el arranque falla porque el fichero que
falta no se puede leer.

## PKI interna

`[server.pki]` habilita la CA que firma certificados de dispositivo y, a la vez,
la lista de revocación consultada durante el handshake mTLS.

```toml
[server.pki]
ca_cert_path = "/etc/ferris/pki/ca.pem"
ca_key_path = "/etc/ferris/pki/ca-key.pem"
default_ttl_seconds = 7776000   # 90 días
```

La clave debe ser ECDSA P-256/P-384 o Ed25519: el backend `ring` no firma con
RSA, y una CA RSA se rechaza al cargar en vez de emitir certificados inútiles.
La CA nunca se entrega a un plugin; solo el material emitido. Por entorno:
`FERRIS_CA_CERT`, `FERRIS_CA_KEY` y `FERRIS_CA_TTL_SECONDS`.

## URL pública

`external_url` es el origen con el que se construyen URLs absolutas que salen
del proceso, hoy las de OAuth: `${external_url}/api/oauth/{provider}/callback`.
Se escribe como `external_url = "https://erp.example.com"` en `[server]`.

Sin `external_url`, Ferris usa el `host:port` de bind y el esquema que implica
TLS. Eso solo es correcto en local: detrás de un proxy, o con bind `0.0.0.0`,
el proveedor rechaza el callback. El arranque avisa cuando detecta ese caso.

:::danger
Si publicas Ferris detrás de un proxy y el navegador llega por HTTPS, configura
`external_url`. Además, las cookies de sesión solo se marcan `Secure` cuando
`[server.tls]` existe; con TLS terminado fuera del proceso, esa marca no se
activa.
:::

## Ejemplos

### Desarrollo

```toml
[server]
host = "127.0.0.1"
port = 8000
roles = ["api", "web", "realtime"]
enable_cors = false
```

Con `FERRIS_JWT_SECRET` definido, `ferris dev` arranca este perfil.

### Producción con TLS en el proceso

```toml
[server]
host = "0.0.0.0"
port = 8443
roles = ["api", "web"]
request_timeout_secs = 30
body_limit_mb = 25
enable_cors = false
external_url = "https://erp.example.com"

[server.tls]
cert_path = "/etc/ferris/tls/fullchain.pem"
key_path = "/etc/ferris/tls/privkey.pem"
min_version = "1.3"

[server.pki]
ca_cert_path = "/etc/ferris/pki/ca.pem"
ca_key_path = "/etc/ferris/pki/ca-key.pem"
```

## Comprobaciones de arranque

Un `serve` falla, con mensaje, cuando la matriz `[features]`/`[mqtt]` pide algo
que el binario no compiló, `[features]` deja la lista de roles vacía,
`tls.require_client_cert` no tiene `client_ca_path`, falta el secreto JWT o
`[server.pki]` apunta a una clave que `ring` no puede usar.
