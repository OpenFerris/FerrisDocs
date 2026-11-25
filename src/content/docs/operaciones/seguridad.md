---
title: Seguridad
description: Sesiones, CSRF, CSP, redacción de secretos, sandbox WASM, mTLS, aislamiento y límites del modelo de seguridad de Ferris.
---

Ferris adopta una postura **fail-closed**: lo que no está configurado no se
habilita, y lo que se pide sin estar compilado detiene el arranque. Esta página
enumera las capas que existen, las que no, y las decisiones que un operador
todavía tiene que tomar.

## Autenticación y sesiones

- Login local con contraseña (Argon2) o OAuth2 + userinfo con PKCE S256 forzado.
- Sesión respaldada en base de datos (`tab_session_store`), no solo en memoria.
- Cookie `__Host-ferris_session` cuando hay TLS en `[server.tls]` **o**
  `[server] external_url` es `https://`; entonces es `HttpOnly`,
  `SameSite=Lax`, `Secure`, `Path=/` y sin `Domain`. Solo en HTTP plano de
  desarrollo se llama `ferris_session` y omite `Secure`. El borrado reutiliza el
  mismo nombre, `Path`, `Secure` y `Domain`.
- Vida absoluta de `session_timeout_minutes` (60 min) y ventana deslizante de
  `session_idle_timeout_minutes` (30 min); cada petición renueva la segunda, no
  la primera.
- Bloqueo tras 5 intentos fallidos durante 15 minutos; el contador de la
  cuenta y `locked_until` se persisten en la fila del usuario y valen para todas
  las réplicas. El límite por IP es local al proceso. Un login correcto los
  limpia.
- Máximo de 5 sesiones concurrentes por usuario; un login extra se rechaza, no
  expulsa a la anterior.
- Política de contraseñas configurable: longitud mínima y las clases
  mayúscula/minúscula/dígito/símbolo.
- MFA TOTP opcional, con activación en dos pasos y **re-autenticación por
  contraseña** en `enable`/`activate`/`disable`.
- Recuperación de contraseña, verificación de correo e invitaciones con tokens
  de un solo uso; solo se guarda su digest SHA-256.
- `Activity Log` registra `login`, `logout` y `login_failed`.

No hay token bearer ni secreto de firma: la cookie es el identificador de sesión
y el registro es la autoridad. Cerrar sesión (o "cerrar todas") borra la fila y
avisa al motor realtime para que cierre los sockets.

## Segundo factor, recuperación y claves de API

- `User.mfa_secret` es un campo `Secret`: el motor lo cifra con AES-256-GCM y
  exige una clave `[secrets]`. Sin clave, habilitar o rotar MFA **falla
  cerrado**; nunca se escribe el secreto en claro.
- El último paso TOTP gastado se persiste en `User.mfa_last_step` con una
  escritura condicional atómica: un código no se puede repetir ni siquiera
  contra otra réplica.
- Los tokens de restablecimiento y verificación se guardan como digest SHA-256,
  caducan (1 h y 48 h) y son de un solo uso. La petición de restablecimiento
  responde siempre `204`: no revela si la dirección tiene cuenta.
- Las claves de API se guardan como digest `sha256:<64 hex>`; el secreto se
  muestra una vez. Una fila heredada con `$argon2...` se actualiza al digest en
  el primer uso correcto. Las claves caducadas o revocadas se rechazan.

## OAuth y verificación de correo

- El flujo es **OAuth2 + userinfo**, no OpenID Connect: un `id_token` no se
  valida (sin JWKS, `iss`, `aud` ni `nonce`). Un proveedor con `oidc = true`
  detiene el arranque.
- `require_verified_email` vale `true` por defecto; un `email_verified` ausente
  o falso se rechaza.
- El `sub` estable del proveedor se vincula a `User.oauth_subject` y un `sub`
  distinto se rechaza; el email por sí solo no enlaza una cuenta.
- El `state` de OAuth vive en `tab_oauth_state` (un solo uso, TTL de 600 s), de
  modo que el callback puede completarse en cualquier réplica.
- Las cuotas por clave de API y el rate limiting general **no** son de Ferris:
  van en la pasarela o el proxy.

## Varias réplicas

Lo que decide un login no vive en la memoria del proceso: el bloqueo y el paso
TOTP se persisten en la fila del usuario, el `state` de OAuth en
`tab_oauth_state` y la sesión en `tab_session_store`. La instantánea de
`User Permission` se recarga cada 30 segundos en cada instancia: una escritura
en otra réplica tarda como mucho esa ventana en aplicarse, y un refresco fallido
conserva la última instantánea buena.

## CSRF

Toda mutación autenticada por **cookie** exige `X-CSRF-Token`. El token lo
entrega el login o `GET /api/auth/session`, y el Desk lo devuelve en cada
llamada.

| Caso | CSRF |
|---|---|
| Cookie de sesión + `POST`/`PUT`/`PATCH`/`DELETE` | Obligatorio |
| `Authorization: token <key>:<secret>` | Exento |
| `GET`/`HEAD`/`OPTIONS` | Exento |
| Certificado de cliente en `/api/method/*` | Exento |

`logout` también lleva CSRF: es una ruta pública con efecto sobre la sesión, y
un formulario de otro sitio no debe poder cerrarla.

## Cabeceras de seguridad

Cada respuesta, incluido el 404, sale con:

El WebSocket de socket.io es *same-origin*, así que `connect-src 'self'` lo
cubre; el código **prohíbe** `ws:`/`wss:` explícitos (hay un test que lo
comprueba), porque abrirlos permitiría exfiltración a cualquier host.

```text
Content-Security-Policy: default-src 'self';
  script-src 'self' 'nonce-<aleatorio>' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://tile.openstreetmap.org;
  font-src 'self' data:;
  connect-src 'self';
  object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-XSS-Protection: 0
```

- El **nonce** se genera por respuesta y se inyecta en los scripts inline del
  SSR. Sin él, la política estricta bloquearía el bootstrap de Leptos.
- `'wasm-unsafe-eval'` permite instanciar el bundle wasm same-origin.
- `style-src 'unsafe-inline'` es necesario porque el SSR emite estilos inline.
- `img-src` nombra un host concreto para las teselas del widget de geolocalización;
  no hay un comodín `https:`.

`frame-ancestors` y `X-Frame-Options` bloquean el clickjacking. `X-XSS-Protection:
0` desactiva el filtro XSS obsoleto, que introduce más problemas de los que
resuelve.

## Redacción de secretos

Tres capas, no una:

1. **Tipos**: `DatabaseConfig`, `AuthConfig`, `RedisConfig`, `SearchConfig`,
   `EmailAccountConfig`, `S3Config`, `AzureConfig`, `SecretsConfig` y `CliConfig` tienen `Debug` escrito a mano que enmascara sus
   credenciales. Un `{:?}` en un log no las imprime.
2. **Informes**: `ferris config show` sustituye por `<redacted>` las claves
   `password`, `passwd`, `secret`, `token`, `access_token`,
   `refresh_token`, `api_key`, `private_key`, `signing_key`, y la contraseña de
   una URL.
3. **Valores**: `SecretValue`, el plaintext de un `Secret`, no implementa
   `Display` ni `Serialize`; solo sale por una lectura que pidió explícitamente
   revelar.

:::caution
`ferris.toml` guarda las credenciales en claro. La redacción evita filtrarlas en
pantalla y en logs, no las cifra en disco. Protege el fichero o genera uno
efímero desde el gestor de secretos.
:::

## Sandbox WASM

Un plugin no recibe el proceso; recibe un mundo y un conjunto de capacidades.

- **Mundo**: `<wasm_dir>/<app>/` (`apps/<app>/` en un bench,
  `sites/<site>/plugins/<app>/` en un sitio) montado en `/world`,
  lectura/escritura. El preopen es el sandbox: wasmtime rechaza `..`, rutas que
  salen de la raíz y un root simbólico. El montaje es por instancia, así que una
  app no ve el mundo de otra.
- **Capacidades primordiales**, siempre concedidas: rutas propias, HTTP saliente
  bajo política, docstore, config, schema, scheduler, notificaciones, pubsub y su
  mundo.
- **Capacidades específicas**, concedidas al declararlas: `http-unrestricted`,
  `tls-client`, `tls-server`, `streams`, `streams-listen`, `pki` y `overrides`.
- **Recursos**: cada llamada al guest tiene un deadline de CPU (reloj de épocas
  de wasmtime) y los payloads están acotados.

No hay `[apps] trusted`, ni lista de grants, ni perfil de confianza. Declarar una
capacidad específica es la petición y la concesión; el host la aplica y rechaza
el import si no está. Una app no puede leer las claves `secret` de la
configuración del operador.

## mTLS y dispositivos

Con `[server.tls] client_ca_path`, el servidor solicita certificado de cliente y
lo verifica contra esa CA. Con `require_client_cert = true`, lo exige.

- El certificado se adjunta a la petición en el handshake, antes de cualquier
  ruta.
- Se acepta como credencial para `/api/method/*`, no para `/api/resource/*`.
- La CA interna (`[server.pki]`) emite certificados de dispositivo y mantiene la
  lista de revocación consultada en el handshake: un certificado revocado se
  rechaza antes de ejecutar la ruta.
- La clave de la CA nunca se entrega a un plugin.

## Aislamiento

| Nivel | Cómo se aísla |
|---|---|
| App WASM | Mundo propio, capacidades, deadline de CPU, sin acceso al host. |
| Petición | Sesión o certificado; permisos por DocType y rol. |
| Ficheros | ACL por fichero; descargas firmadas con expiración y HMAC. |
| Proceso | Una base de datos por proceso. |

:::danger[Multi-tenant]
`TenantManager` y `ferris tenant` gestionan configuraciones de tenant (un JSON
por tenant, con su base de datos, Redis, ficheros y admin), pero el servidor
**no** resuelve el tenant por `Host` en la ruta de petición. Un proceso sirve la
base que dice su configuración. No presentes una instalación como multi-tenant
por host sin poner un enrutador delante que seleccione la instancia.
:::

## Qué NO hace Ferris

- **No hay WAF** ni filtrado de payloads de aplicación.
- **No hay rate limiting global** por IP o por ruta, ni cuotas por clave de API;
  solo el bloqueo de login por usuario y el limitador del flujo de recuperación.
  Las cuotas, si hacen falta, van en la pasarela o el proxy.
- **No hay antivirus** ni análisis de ficheros subidos.
- **No hay cifrado del fichero de configuración**.
- **No hay rotación automática** de secretos de integración o certificados.
- **No hay SSO SAML** ni validación de OIDC/`id_token`; OAuth2 + userinfo es el
  mecanismo soportado.
- **No hay aislamiento multi-tenant por host** en el servidor.
- **No hay métricas Prometheus** ni trazas OTLP cableadas.
- **No hay registro de lecturas** más allá de los logs de petición.

## Lista de endurecimiento

- [ ] Clave de secretos por entorno, nunca en el repositorio. MFA no se puede
      habilitar sin ella.
- [ ] TLS con `min_version = "1.3"` si el cliente lo soporta.
- [ ] `external_url` correcto y HTTPS: decide el `Secure` de la cookie; CORS
      apagado o con lista explícita.
- [ ] `body_limit_mb` y timeouts alineados con el proxy.
- [ ] Base de datos con `verify-full` y usuario de mínimos privilegios.
- [ ] Ficheros y mundos de plugins en volúmenes con permisos restringidos.
- [ ] `[secrets] previous_keys` solo mientras queden filas por reescribir.
- [ ] Revisar qué apps están en `[apps] enabled` y qué capacidades declaran.
- [ ] `ferris doctor` en el pipeline de despliegue.
- [ ] Logs de petición recolectados y alertados en 5xx.

## Ejemplo endurecido

```toml
[server]
external_url = "https://erp.example.com"
enable_cors = false
body_limit_mb = 25
request_timeout_secs = 30

[server.tls]
cert_path = "/etc/ferris/tls/fullchain.pem"
key_path = "/etc/ferris/tls/privkey.pem"
min_version = "1.3"

```

```bash
openssl rand -hex 32                       # FERRIS_SECRET_KEY
curl -sI https://erp.example.com/health | grep -i strict-transport-security
```

La segunda comprobación debe devolver la cabecera HSTS; si no aparece, el
proceso no está viendo la petición por HTTPS o el proxy la está eliminando.
