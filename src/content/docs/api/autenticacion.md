---
title: Autenticación (API)
description: Login por sesión, cookie y CSRF, MFA con TOTP y códigos de respaldo, recuperación, invitaciones, claves de API y OAuth2 + userinfo.
---

Ferris autentica con **sesiones en cookie**. El login valida la contraseña
(Argon2id), crea una sesión en `tab_session_store` mediante `tower-sessions` +
`axum-login`, escribe la cookie y devuelve el token CSRF en una cabecera para que
el cliente pueda mutar.

Las rutas de sesión se montan **fuera** del middleware `require_auth`: son la
forma de entrar. `logout`, en cambio, lleva el gate CSRF.

## Login

```http
POST /api/auth/login
Content-Type: application/json
```

```json
{ "username": "admin@local", "password": "ferrisAdmin123" }
```

`username` acepta tanto el `email` como el `username` del usuario; la búsqueda
prueba `email` primero y `username` después.

```bash
curl -s -i -c cookies.txt -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@local","password":"ferrisAdmin123"}'
```

Respuesta correcta: `200` con la identidad pública y dos artefactos.

```http
Set-Cookie: ferris_session=…; HttpOnly; SameSite=Lax; Path=/
X-CSRF-Token: 9f2c…
```

```json
{ "id": "admin@local", "email": "admin@local", "username": "admin",
  "full_name": "Administrator", "roles": ["System Manager"],
  "user_type": "SystemUser" }
```

La cookie se llama `__Host-ferris_session` y lleva `Secure` cuando hay TLS
configurado **o** `[server] external_url` es `https://`; en desarrollo sobre
HTTP plano se llama `ferris_session` y no lleva `Secure`. `logout` y las
sesiones caducadas borran la cookie con el mismo nombre, `Path`, `Secure` y
`Domain`.

Fallos posibles:

| Estado | `error` | Cuándo |
|---|---|---|
| `401` | `unauthorized` | Credenciales vacías, usuario/contraseña inválidos, cuenta deshabilitada |
| `429` | `rate_limited` | Se agotaron los intentos (`max_login_attempts`, 5 por defecto) |
| `500` | `internal` | Fallo de almacenamiento; el mensaje no describe la causa |

El bloqueo de la cuenta se persiste en `User.failed_login_attempts` y
`User.locked_until`, así que lo ven todas las réplicas; el contador por IP es
local al proceso. Un login correcto limpia ambos. La IP es el peer TCP de la
conexión: `X-Forwarded-For` y `X-Real-IP` **no** se consultan, porque son
controladas por el cliente.

Cada intento rechazado escribe una fila `login_failed` en `Activity Log`; un
login correcto escribe `login` y un cierre de sesión, `logout`.

## MFA

Si la cuenta tiene MFA activo, el login **no** abre sesión: responde `200` con

```json
{ "mfa_required": true, "challenge": "8b1d4a3e-…" }
```

El reto dura 5 minutos, es de un solo uso y vive en **la propia sesión**, no en
un mapa del proceso. Por eso `verify` puede aterrizar en otra réplica:

```bash
curl -s -c cookies.txt -D headers.txt -X POST \
  http://localhost:8000/api/auth/mfa/verify \
  -H 'Content-Type: application/json' \
  -d '{"challenge":"8b1d4a3e-…","code":"123456"}'
```

`code` es un TOTP (ventana de ±1 periodo) **o** un código de respaldo de un solo
uso. El éxito devuelve la respuesta de un login normal, con cookie y CSRF.

### Autoservicio de MFA

Las tres rutas van dentro de `require_auth` y del gate CSRF. Además exigen la
**contraseña de la cuenta** en el cuerpo: una sesión viva no basta para
matricular otro autenticador ni para apagar el segundo factor.

```bash
# 1. Generar secreto y códigos de respaldo (no activa todavía)
curl -s -b cookies.txt -X POST http://localhost:8000/api/auth/mfa/enable \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"account_name":"admin@local","password":"ferrisAdmin123"}'
```

```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauth_uri": "otpauth://totp/Ferris:admin@local?secret=…",
  "backup_codes": ["…", "…"]
}
```

Los códigos de respaldo se devuelven **solo** ahí; el servidor guarda hashes
Argon2. El secreto TOTP se guarda como campo `Secret` (AES-256-GCM): sin una
clave `[secrets]` instalada, `enable` falla cerrado con `KeyMissing` en vez de
escribir el secreto en claro.

```bash
# 2. Verificar el primer código TOTP; solo entonces se activa
curl -s -b cookies.txt -X POST http://localhost:8000/api/auth/mfa/activate \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"code":"123456","password":"ferrisAdmin123"}'
# {"status":"enabled","id":"admin@local"}

# 3. Desactivar probando un TOTP o gastando un código de respaldo
curl -s -b cookies.txt -X POST http://localhost:8000/api/auth/mfa/disable \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"code":"123456","password":"ferrisAdmin123"}'
# {"status":"disabled","id":"admin@local"}
```

Una contraseña ausente o incorrecta es un `400` y no cambia nada. `enable` sobre
una cuenta ya activa, o `activate` sin secreto pendiente, responden `400`. El
emisor es `Ferris`; los dígitos, el periodo y el número de códigos de respaldo
salen del `AuthConfig`, no de la petición.

Un TOTP no se puede reutilizar: el último paso gastado se persiste en
`User.mfa_last_step` con una actualización condicional atómica, compartida por
todas las réplicas.

## Sesión actual

```bash
curl -s -b cookies.txt -D headers.txt http://localhost:8000/api/auth/session
```

Devuelve la identidad pública y vuelve a poner `X-CSRF-Token` en la respuesta.
Es la forma de recuperar el token tras recargar la página. Sin cookie o con una
sesión caducada responde `401` (`not signed in` / `session expired`).

La sesión caduca por tiempo absoluto (`session_timeout_minutes`, 60) o por
inactividad (`session_idle_timeout_minutes`, 30). La ventana deslizante se
renueva con cada petición; el techo absoluto no. Una sesión sin fecha absoluta
—una fila heredada— no se considera viva. Al superar `max_sessions_per_user` (5),
el login responde `429` en vez de expulsar otra pestaña.

## Logout

```bash
curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X POST \
  http://localhost:8000/api/auth/logout \
  -H "X-CSRF-Token: $CSRF"
```

Responde `204`, borra la sesión del almacén y manda la cookie con `Max-Age=0`,
reutilizando nombre, `Path`, `Secure` y `Domain`. Lleva CSRF a propósito: un
formulario de otro sitio no debe poder cerrar tu sesión.

## Recuperación y verificación de correo

Ambos flujos emiten un token de 32 bytes, guardan solo su digest SHA-256 en la
fila del usuario y envían el enlace por el `MailerPort` del host. El token no se
registra ni se devuelve en la respuesta.

| Ruta | Sesión | Respuesta |
|---|---|---|
| `POST /api/auth/password-reset/request` | no | Siempre `204`; el cuerpo es `{"email":"…"}`. |
| `POST /api/auth/password-reset/confirm` | no | `204`, o `400` si el token no sirve. |
| `POST /api/auth/email/verify/request` | sí + CSRF | `204`. |
| `POST /api/auth/email/verify/confirm` | no | `204`, o `400` si el token no sirve. |

```bash
# Pedir el enlace: la respuesta no distingue una cuenta existente
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:8000/api/auth/password-reset/request \
  -H 'Content-Type: application/json' -d '{"email":"ada@example.com"}'

# Gastar el token y fijar la contraseña nueva
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:8000/api/auth/password-reset/confirm \
  -H 'Content-Type: application/json' \
  -d '{"token":"…","new_password":"una-clave-larga"}'
```

`password-reset/request` responde `204` para una dirección desconocida, una
cuenta deshabilitada o un fallo de almacenamiento: no hay enumeración de
usuarios. El enlace de restablecimiento vale **1 hora**; el de verificación,
**48 horas**. Ambos son de un solo uso.

La verificación se pide desde una sesión (`POST /api/auth/email/verify/request`,
sin cuerpo) y se confirma en la ruta pública con `{"token":"…"}`. Sin mailer
configurado el flujo no falla: se registra un aviso y la petición sigue siendo
`204`.

## Invitaciones

| Ruta | Rol | Respuesta |
|---|---|---|
| `POST /api/auth/invitations` | `System Manager` | `201` con la invitación, sin token. |
| `GET /api/auth/invitations` | `System Manager` | Lista de invitaciones, sin token. |
| `DELETE /api/auth/invitations/{id}` | `System Manager` | `204`. |
| `POST /api/auth/invitations/accept` | pública | `204`, o `400` genérico. |

```bash
# Emitir: caducidad por defecto 48 h; máximo 30 días
curl -s -b cookies.txt -X POST http://localhost:8000/api/auth/invitations \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"email":"ada@example.com","full_name":"Ada","roles":["System User"]}'

# Aceptar: crea la cuenta y el token queda gastado
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:8000/api/auth/invitations/accept \
  -H 'Content-Type: application/json' \
  -d '{"token":"…","full_name":"Ada Lovelace","password":"una-clave-larga"}'
```

`ttl_seconds` acota la validez (de 1 segundo a 30 días). La invitación es de un
solo uso y el token viaja solo en el correo; `User Invitation.token_hash` guarda
su digest. Un token inválido, caducado o ya aceptado es un `400` que no distingue
el motivo.

## Claves de API

El middleware acepta una credencial sin cookie:

- `Authorization: token <key>:<secret>` — clave de la tabla `API Key`.

No hay JWT ni endpoint que emita tokens bearer. Un cliente máquina usa su clave
de API; el Desk y el navegador usan la cookie de sesión. Una clave válida queda
**exenta** de CSRF: un atacante cross-site no puede adjuntar esa cabecera sin
conocer el secreto.

Cada cuenta gestiona sus claves; el `secret` se devuelve **una sola vez** al
crearla y se guarda como digest `sha256:<64 hex>`, nunca en claro ni en un
listado posterior.

```bash
# Emitir: 201 con el secreto, que no se puede volver a leer
curl -s -b cookies.txt -X POST http://localhost:8000/api/auth/api-keys \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"description":"CI"}'
# {"id":"…","key":"…","secret":"…","expires_at":null}

# Listar (sin hash) y revocar
curl -s -b cookies.txt http://localhost:8000/api/auth/api-keys
curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X DELETE \
  http://localhost:8000/api/auth/api-keys/… -H "X-CSRF-Token: $CSRF"
```

Una clave deshabilitada o caducada se rechaza en cada petición. Las filas
antiguas con hash `$argon2...` se aceptan y se reescriben con el digest SHA-256
en el primer uso correcto. La clave de otra cuenta responde `404`, igual que un
identificador inexistente. Las cuotas por clave **no** las aplica Ferris: si las
necesitas, configúralas en la pasarela o el proxy.

## OAuth2 + userinfo

```text
GET /api/oauth/providers
GET /api/oauth/{provider}/login?next=/desk
GET /api/oauth/{provider}/callback?code=…&state=…
```

- `login` genera un `state` de un solo uso, lo persiste en `tab_oauth_state`
  (TTL 600 s) y lo ata a este navegador con una cookie `HttpOnly`,
  `SameSite=Lax` y ámbito `/api/oauth`; luego redirige (302).
- `callback` verifica la cookie, consume el `state` en la base —de modo que otra
  réplica puede completar el flujo—, canjea el código con PKCE, resuelve la
  cuenta y abre una **sesión** (cookie + `X-CSRF-Token`), redirigiendo con 303 a
  `next` (por defecto `/desk`). Los tokens del proveedor nunca llegan al
  navegador.
- La cuenta debe existir y estar habilitada: no hay auto-provisioning, y una
  cuenta con MFA activo se rechaza (el proveedor no puede dar el segundo factor).

Es **OAuth2 + userinfo**, no OpenID Connect. Un `id_token` **no se valida**: no
hay firma JWKS ni comprobación de `iss`/`aud`/`nonce`/`exp`, y un proveedor con
`oidc = true` se rechaza al construir el manager en vez de ignorar el token.

`require_verified_email` vale `true` por defecto: si el userinfo no trae
`email_verified: true`, el login se rechaza. El `email` por sí solo no basta
para enlazar una cuenta: el `sub` estable del proveedor se vincula a
`User.oauth_subject` en el primer login y un `sub` distinto se rechaza.

`next` solo acepta rutas internas; cualquier otra cosa cae en `/desk`.

## Configuración relevante

```toml
[auth]
password_min_length = 12
password_require_uppercase = true
password_require_lowercase = true
password_require_numbers = true
password_require_symbols = false
session_idle_timeout_minutes = 30
```

La vida absoluta es `session_timeout_minutes` (60 por defecto). Los cinco
valores de la política de contraseñas se aplican al crear, cambiar y
restablecer una clave.

La cookie se llama `__Host-ferris_session` cuando hay TLS en `[server.tls]` o
`external_url` es `https://`; entonces lleva `Secure`, `Path=/` y ningún
`Domain`. En HTTP plano de desarrollo se llama `ferris_session` y no lleva
`Secure`.
