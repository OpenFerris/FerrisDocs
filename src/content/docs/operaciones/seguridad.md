---
title: Seguridad
description: Sesiones, CSRF, CSP, redacción de secretos, sandbox WASM, mTLS, aislamiento y límites del modelo de seguridad de Ferris.
---

Ferris adopta una postura **fail-closed**: lo que no está configurado no se
habilita, y lo que se pide sin estar compilado detiene el arranque. Esta página
enumera las capas que existen, las que no, y las decisiones que un operador
todavía tiene que tomar.

## Autenticación y sesiones

- Login local con contraseña (Argon2) o OAuth2 con PKCE S256 forzado.
- Sesión respaldada en base de datos, no solo un JWT en memoria.
- Cookie `ferris_session`: `HttpOnly`, `SameSite=Lax`, `Secure` cuando hay TLS
  en el proceso.
- Bloqueo tras 5 intentos fallidos durante 15 minutos; un login correcto limpia
  el contador.
- Máximo de 5 sesiones concurrentes por usuario; un login extra se rechaza, no
  expulsa a la anterior.
- MFA TOTP opcional, con activación en dos pasos.

El JWT se firma con HS256 y un secreto de 32+ caracteres. No hay secreto por
defecto ni forma de arrancar sin él.

## CSRF

Toda mutación autenticada por **cookie** exige `X-CSRF-Token`. El token lo
entrega el login o `GET /api/auth/session`, y el Desk lo devuelve en cada
llamada.

| Caso | CSRF |
|---|---|
| Cookie de sesión + `POST`/`PUT`/`PATCH`/`DELETE` | Obligatorio |
| `Authorization: Bearer` | Exento |
| `GET`/`HEAD`/`OPTIONS` | Exento |
| Certificado de cliente en `/api/method/*` | Exento |

`logout` también lleva CSRF: es una ruta pública con efecto sobre la sesión, y
un formulario de otro sitio no debe poder cerrarla.

## Cabeceras de seguridad

Cada respuesta, incluido el 404, sale con:

```text
Content-Security-Policy: default-src 'self';
  script-src 'self' 'nonce-<aleatorio>' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://tile.openstreetmap.org;
  font-src 'self' data:;
  connect-src 'self' ws: wss:;
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
   `password`, `passwd`, `secret`, `jwt_secret`, `token`, `access_token`,
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

- **Mundo**: `plugins/<app>/` montado en `/world`, lectura/escritura. El preopen
  es el sandbox: wasmtime rechaza `..`, rutas que salen de la raíz y un root
  simbólico. El montaje es por instancia, así que una app no ve el mundo de otra.
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
- **No hay rate limiting global** por IP o por ruta; solo el bloqueo de login por
  usuario.
- **No hay antivirus** ni análisis de ficheros subidos.
- **No hay cifrado del fichero de configuración**.
- **No hay rotación automática** de JWT, secretos de integración o certificados.
- **No hay SSO SAML** ni OIDC con descubrimiento.
- **No hay aislamiento multi-tenant por host** en el servidor.
- **No hay métricas Prometheus** ni trazas OTLP cableadas.
- **No hay registro de lecturas** más allá de los logs de petición.

## Lista de endurecimiento

- [ ] JWT y clave de secretos por entorno, nunca en el repositorio.
- [ ] TLS con `min_version = "1.3"` si el cliente lo soporta.
- [ ] `external_url` correcto; CORS apagado o con lista explícita.
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

[auth]
mfa_enabled = true
```

```bash
openssl rand -hex 32                       # FERRIS_JWT_SECRET
openssl rand -hex 32                       # FERRIS_SECRET_KEY
curl -sI https://erp.example.com/health | grep -i strict-transport-security
```

La segunda comprobación debe devolver la cabecera HSTS; si no aparece, el
proceso no está viendo la petición por HTTPS o el proxy la está eliminando.
