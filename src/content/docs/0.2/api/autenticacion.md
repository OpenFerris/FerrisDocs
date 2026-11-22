---
title: Autenticación (API)
description: Login por sesión, cookie y CSRF, MFA con TOTP y códigos de
  respaldo, OAuth2/PKCE y qué pasa con JWT.
slug: 0.2/api/autenticacion
---

Ferris autentica con **sesiones en cookie**. El login valida la contraseña
(Argon2id), crea una sesión en la tabla `Session`, escribe la cookie y devuelve el
token CSRF en una cabecera para que el cliente pueda mutar.

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

Fallos posibles:

| Estado | `error` | Cuándo |
|---|---|---|
| `401` | `unauthorized` | Credenciales vacías, usuario/contraseña inválidos, cuenta deshabilitada |
| `429` | `rate_limited` | Se agotaron los intentos (`max_login_attempts`, 5 por defecto) |
| `500` | `internal` | Fallo de almacenamiento; el mensaje no describe la causa |

El bloqueo cuenta **solo fallos**, por IP y por cuenta, y un login correcto limpia
ambos contadores. La IP sale de `X-Forwarded-For` o `X-Real-IP`.

## MFA

Si la cuenta tiene MFA activo, el login **no** abre sesión: responde `200` con

```json
{ "mfa_required": true, "challenge": "8b1d4a3e-…" }
```

El reto dura 5 minutos, es de un solo uso y vive en memoria del proceso:

```bash
curl -s -c cookies.txt -D headers.txt -X POST \
  http://localhost:8000/api/auth/mfa/verify \
  -H 'Content-Type: application/json' \
  -d '{"challenge":"8b1d4a3e-…","code":"123456"}'
```

`code` es un TOTP (ventana de ±1 periodo) **o** un código de respaldo de un solo
uso. El éxito devuelve la respuesta de un login normal, con cookie y CSRF.

:::caution[Un proceso, un reto]
El mapa de retos pendientes es local al proceso. Con varias instancias, el
`verify` debe llegar a la que emitió el `challenge`, o el reto hay que
externalizarlo.
:::

### Autoservicio de MFA

Las tres rutas van dentro de `require_auth` y del gate CSRF.

```bash
# 1. Generar secreto y códigos de respaldo (no activa todavía)
curl -s -b cookies.txt -X POST http://localhost:8000/api/auth/mfa/enable \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"account_name":"admin@local"}'
```

```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauth_uri": "otpauth://totp/Ferris:admin@local?secret=…",
  "backup_codes": ["…", "…"]
}
```

Los códigos de respaldo se devuelven **solo** ahí; el servidor guarda sus hashes.

```bash
# 2. Verificar el primer código TOTP; solo entonces se activa
curl -s -b cookies.txt -X POST http://localhost:8000/api/auth/mfa/activate \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"code":"123456"}'
# {"status":"enabled","id":"admin@local"}

# 3. Desactivar probando un TOTP o gastando un código de respaldo
curl -s -b cookies.txt -X POST http://localhost:8000/api/auth/mfa/disable \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -d '{"code":"123456"}'
# {"status":"disabled","id":"admin@local"}
```

`enable` sobre una cuenta ya activa, o `activate` sin secreto pendiente,
responden `400`. El emisor, dígitos y periodo salen de `[auth]` (`mfa_issuer`,
`mfa_enabled`), no de la petición.

## Sesión actual

```bash
curl -s -b cookies.txt -D headers.txt http://localhost:8000/api/auth/session
```

Devuelve la identidad pública y vuelve a poner `X-CSRF-Token` en la respuesta.
Es la forma de recuperar el token tras recargar la página. Sin cookie o con una
sesión caducada responde `401` (`not signed in` / `session expired`).

La sesión caduca por tiempo absoluto (`session_timeout_minutes`, 60) o por
inactividad (`idle_timeout_minutes`). Al superar `max_sessions_per_user` (5), el
login responde `429` en vez de expulsar otra pestaña.

## Logout

```bash
curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X POST \
  http://localhost:8000/api/auth/logout \
  -H "X-CSRF-Token: $CSRF"
```

Responde `204`, borra la sesión del almacén y manda la cookie con `Max-Age=0`.
Lleva CSRF a propósito: un formulario de otro sitio no debe poder cerrar tu
sesión.

## JWT y claves de API

El middleware acepta dos credenciales sin cookie:

* `Authorization: Bearer <jwt>` — HS256 con `FERRIS_JWT_SECRET` (o
  `JWT_SECRET`), mínimo 32 caracteres; access 24 h, refresh 30 días en `[auth]`.
* `Authorization: token <key>:<secret>` — API key de Frappe (tabla `API Key`).

:::danger[No hay endpoint que emita JWT]
`ferris-auth` genera y refresca tokens (`generate_tokens`,
`refresh_access_token`), pero la superficie HTTP **no expone**
`/api/auth/token` ni `/api/auth/refresh`. Un cliente externo debe obtener el
Bearer por otra vía. Para llamadas normales, usa cookie de sesión.
:::

Un Bearer válido queda **exento** de CSRF: un atacante cross-site no puede
adjuntar esa cabecera sin robar el token.

## OAuth2 / PKCE

```text
GET /api/oauth/providers
GET /api/oauth/{provider}/login?next=/desk
GET /api/oauth/{provider}/callback?code=…&state=…
```

* `login` genera un `state` de un solo uso, lo ata a **este navegador** con una
  cookie `HttpOnly`, `SameSite=Lax` y ámbito `/api/oauth`, y redirige (302).
* `callback` verifica la cookie, canjea el código con PKCE, resuelve la cuenta
  por email y abre una **sesión** (cookie + `X-CSRF-Token`), redirigiendo con 303
  a `next` (por defecto `/desk`). Los tokens del proveedor nunca llegan al
  navegador.
* La cuenta debe existir y estar habilitada: no hay auto-provisioning, y una
  cuenta con MFA activo se rechaza (el proveedor no puede dar el segundo factor).

`next` solo acepta rutas internas; cualquier otra cosa cae en `/desk`.

## Configuración relevante

```toml
[auth]
max_login_attempts = 5
lockout_duration_minutes = 15
mfa_enabled = false
session_timeout_minutes = 60
max_sessions_per_user = 5
```

`password_require_uppercase/lowercase/numbers/symbols` también existen; por
defecto los tres primeros están activos y el de símbolos no.

La cookie se llama `ferris_session`, es `HttpOnly` y `SameSite=Lax`, y lleva
`Secure` automáticamente cuando hay TLS (`[server] tls`).
