---
title: Autenticación (configuración)
description: "Sesiones con tower-sessions, CSRF, política de contraseñas, MFA, recuperación, invitaciones, claves de API y proveedores OAuth en la sección [auth]."
---

`[auth]` reúne la política de contraseñas, el segundo factor, la vida de la
sesión y los proveedores OAuth que el Desk puede usar para iniciar sesión. Ya
**no** hay secreto de firma JWT: la sesión es una cookie respaldada por
`tab_session_store` y administrada por `tower-sessions` + `axum-login`.

```toml
[auth]
password_min_length = 12
password_require_uppercase = true
password_require_lowercase = true
password_require_numbers = true
password_require_symbols = true
session_idle_timeout_minutes = 30
```

## Campos

| Clave | Tipo | Por defecto | Efecto |
|---|---|---|---|
| `password_min_length` | usize | `8` | Longitud mínima, contada en caracteres. |
| `password_require_uppercase` | bool | `true` | Exige al menos una mayúscula. |
| `password_require_lowercase` | bool | `true` | Exige al menos una minúscula. |
| `password_require_numbers` | bool | `true` | Exige al menos un dígito. |
| `password_require_symbols` | bool | `false` | Exige al menos un símbolo. |
| `session_idle_timeout_minutes` | u64 | `30` | Ventana deslizante de inactividad. |
| `session_timeout_minutes` | u64 | `60` | Vida **absoluta** de la sesión (techo). |
| `max_sessions_per_user` | u32 | `5` | Sesiones concurrentes; un login extra se rechaza. |
| `max_login_attempts` | u32 | `5` | Intentos fallidos antes del bloqueo. |
| `lockout_duration_minutes` | u64 | `15` | Duración del bloqueo. |
| `mfa_issuer` | string | `"Ferris"` | Emisor que muestra la app autenticadora en el URI `otpauth://`. |
| `require_email_verification` | bool | `false` | Exige un correo verificado para iniciar sesión. |
| `[auth.oauth]` | tabla | sin proveedores | Habilita `/api/oauth/*`. |

La política de contraseñas se aplica al crear una cuenta, al cambiarla y al
confirmar un restablecimiento. Las cuatro clases de caracteres y la longitud
mínima se comprueban juntas; un valor que no las cumple es un `400`.

El `email` y el `username` de `User` son **únicos** (índices únicos): el login
resuelve la cuenta por email y luego por usuario, y un restablecimiento busca
por email, así que dos cuentas con la misma dirección harían que el acceso y el
enlace de recuperación resolvieran una cuenta arbitraria. La segunda alta con
un email o usuario ya tomado se rechaza como conflicto.

:::caution[Qué lee `ferris serve`]
`ferris serve` traslada al `AuthConfig` del núcleo todas las claves de esta
sección: `password_*`, `session_timeout_minutes`, `session_idle_timeout_minutes`,
`max_sessions_per_user`, `max_login_attempts`, `lockout_duration_minutes`,
`mfa_issuer`, `require_email_verification` y `[auth.oauth]`. Si una clave falta,
se aplica el defecto de la tabla.
:::

## Sesiones

El login abre una sesión en `tab_session_store`. La cookie es `HttpOnly` y
`SameSite=Lax`; su nombre y el atributo `Secure` salen de una sola decisión:

| Condición | Cookie |
|---|---|
| `[server.tls]` configurado **o** `[server] external_url` empieza por `https://` | `__Host-ferris_session`, con `Secure`, `Path=/` y sin `Domain` |
| Ninguna de las dos | `ferris_session`, sin `Secure` (solo desarrollo) |

El prefijo `__Host-` obliga a `Secure`, `Path=/` y ningún `Domain`, así que la
cookie no puede ser ensombrecida por un subdominio. La comparación del esquema
ignora mayúsculas y espacios iniciales, porque el valor lo edita una persona.

`external_url` es la señal para un despliegue detrás de un proxy que termina
TLS: el proceso habla HTTP plano, pero el navegador ve un origen HTTPS y la
cookie sin `Secure` viajaría por un transporte inseguro. El borrado
(`logout`, `logout-all`, sesión caducada) usa el mismo nombre, `Path`,
`Secure` y `Domain`, con `Max-Age=0`; nunca deja una cookie huérfana.

| Ajuste | Valor efectivo |
|---|---|
| Vida absoluta | `session_timeout_minutes` (60 min) |
| Ventana de inactividad | `session_idle_timeout_minutes` (30 min) |
| Sesiones concurrentes por usuario | `max_sessions_per_user` (5) |
| Intentos fallidos antes de bloqueo | `max_login_attempts` (5) |
| Duración del bloqueo | `lockout_duration_minutes` (15 min) |

La vida absoluta es un techo que se comprueba al leer la sesión: una sesión sin
ese dato (por ejemplo, una fila heredada) **no** se considera viva. La ventana
deslizante es el TTL que se entrega al almacén: cada petición la renueva y el
techo absoluto no se mueve.

Solo los intentos **fallidos** cuentan para el bloqueo; un login correcto limpia
el contador persistido en la fila del usuario. El contador y `locked_until` viven
en la base, no en memoria: dos réplicas ven el mismo bloqueo.

Un cambio de contraseña o de MFA cambia el *fingerprint* de la sesión y
invalida todas las sesiones existentes de esa cuenta.

### Rutas sin sesión

| Ruta | Método | Función |
|---|---|---|
| `/api/auth/login` | `POST` | Valida credenciales; abre sesión o devuelve un reto MFA. |
| `/api/auth/session` | `GET` | Devuelve la identidad de la sesión actual y el token CSRF. |
| `/api/auth/mfa/verify` | `POST` | Completa el reto MFA del login. |
| `/api/auth/password-reset/request` | `POST` | Pide un enlace de restablecimiento. Siempre `204`. |
| `/api/auth/password-reset/confirm` | `POST` | Gasta el token y fija la contraseña nueva. |
| `/api/auth/email/verify/confirm` | `POST` | Marca el correo como verificado. |
| `/api/auth/invitations/accept` | `POST` | Crea la cuenta a partir de una invitación. |

Estas rutas quedan fuera de `require_auth` porque son la forma de entrar o de
recuperar el acceso. Las de recuperación, verificación e invitaciones responden
`204`/`400` genéricos y nunca dicen si una dirección tiene cuenta.

### Rutas con CSRF

`logout`, `logout-all`, el autoservicio de MFA,
`POST /api/auth/email/verify/request`, las claves de API y las invitaciones
llevan la capa CSRF; el autoservicio de MFA, esa petición, las claves y las
invitaciones exigen además una sesión. `logout` elimina el registro de sesión
y avisa al motor realtime para que cierre los sockets abiertos con esa cookie.
`logout-all` borra por índice de usuario todas las filas de `tab_session_store`
de la cuenta y cierra todos sus sockets. Ninguna de las dos está en
`require_auth`: cerrar una sesión ya caducada no debe dar un `401`.

## CSRF

Las peticiones autenticadas por **cookie** deben enviar `X-CSRF-Token` con el
valor que entregó el login o `GET /api/auth/session`, en toda ruta mutante. Los
llamadores con `Authorization: token <key>:<secret>` (clave de API) y los
métodos `GET`/`HEAD`/`OPTIONS` están exentos. El token vive en la propia sesión
y se compara en tiempo constante. La capa vive dentro del router de la API,
después de resolver la sesión.

## MFA

MFA se activa **por usuario**, no con un interruptor global de `[auth]`. El
login responde con un reto de corta vida (5 minutos) guardado en la propia
sesión —no en un mapa global— y el cliente lo completa en
`/api/auth/mfa/verify`.

Rutas de autoservicio, autenticadas y con CSRF:

| Ruta | Función |
|---|---|
| `POST /api/auth/mfa/enable` | Genera el secreto y el URI `otpauth://`. |
| `POST /api/auth/mfa/activate` | Confirma el primer código y activa MFA. |
| `POST /api/auth/mfa/disable` | Desactiva MFA para el usuario. |

**Las tres exigen la contraseña de la cuenta** (`password` en el cuerpo). Una
cookie viva no basta para matricular otro autenticador ni para apagar el segundo
factor: la contraseña se verifica con `UserStore::verify_login` antes de escribir
nada. `activate` pide además un TOTP; `disable` pide un TOTP o un código de
respaldo. Así se prueban los dos factores antes de cambiar el segundo.

El emisor del URI es `Ferris`. El código tiene 6 dígitos y paso de 30 segundos
por defecto. La activación es en dos pasos: un usuario no puede quedar con MFA
activo sin haber probado nunca un código. Un TOTP no se puede reutilizar dentro
de su ventana de validez: el último paso gastado se persiste en
`User.mfa_last_step` con una actualización condicional atómica, así que la
protección contra repetición también vale entre réplicas.

### El secreto MFA es un `Secret`

`User.mfa_secret` es un campo `Secret`: el motor lo cifra con AES-256-GCM y solo
lo entrega a una lectura que pidió `reveal_secrets()`. Guardarlo exige una clave
`[secrets]` instalada. **Sin clave, `enable` y cualquier rotación de MFA fallan
cerrados** (`KeyMissing`): no se escribe un secreto en claro ni se deja una fila
a medias. Una fila heredada con el secreto en claro se sigue leyendo; la
siguiente escritura la sella.

## Recuperación de contraseña y verificación de correo

El servicio genera un token de 32 bytes y guarda **solo** su digest SHA-256 en
`User.reset_password_key` / `User.email_verification_key`, con su caducidad en
`reset_password_expires_at` / `email_verification_expires_at`. El token viaja
únicamente en el cuerpo del correo que envía el `MailerPort` del host; nunca se
registra ni se devuelve en la respuesta.

- `password-reset/request` responde siempre `204`, también para una dirección
  desconocida, una cuenta deshabilitada o un fallo de almacenamiento. No hay
  enumeración de usuarios. El enlace vale **1 hora**.
- `password-reset/confirm` gasta el token una sola vez y aplica la política de
  contraseñas; después borra la clave y la caducidad.
- `email/verify/request` es autenticada y con CSRF: la cuenta pide el enlace
  para su propia dirección. Responde `204`, incluso si ya estaba verificada.
- `email/verify/confirm` es pública y marca `email_verified`. El enlace vale
  **48 horas**.

Sin `MailerPort` configurado el flujo no falla: se registra un aviso y la
respuesta sigue siendo `204`. Un token caducado, ya usado o desconocido es un
`400` genérico.

### Exigir el correo verificado

`require_email_verification` es **opt-in** y vale `false` por defecto, así que
una instalación existente no cambia de comportamiento. Con el interruptor
activo, un login con la contraseña correcta (y el segundo factor, si la cuenta
lo tiene) de una cuenta cuyo `email_verified` sigue en `false` se rechaza con
`403` y el mensaje «verify your email address before signing in»; no se abre
sesión. La comprobación ocurre **después** de probar la credencial, así que no
revela si la cuenta existe.

Un correo verificado por el proveedor OAuth (`email_verified: true`) satisface
la política: esa es la prueba del IdP. En ese caso el callback marca
`email_verified` en la cuenta local antes de abrir la sesión; si la escritura
falla, se registra un aviso y el login continúa.

## Invitaciones

`User Invitation` guarda el digest del token (`token_hash`), su caducidad
(`expires_at`), quién la emitió (`invited_by`) y cuándo se aceptó
(`accepted_at`). La invitación es de un solo uso y crea la cuenta al aceptarla.

| Ruta | Rol | Función |
|---|---|---|
| `POST /api/auth/invitations` | `System Manager` | Emite la invitación y envía el enlace. |
| `GET /api/auth/invitations` | `System Manager` | Lista las invitaciones, sin token. |
| `DELETE /api/auth/invitations/{id}` | `System Manager` | Revoca una invitación. |
| `POST /api/auth/invitations/accept` | pública | Crea la cuenta con el token. |

La caducidad por defecto es de 48 horas y el máximo aceptado es de 30 días
(`ttl_seconds`). La lista nunca incluye el token ni su digest. Aceptar una
invitación es un `204`; un token inválido, caducado o ya usado es un `400` que no
distingue el motivo.

## Claves de API

Cada cuenta emite sus propias claves y las usa con
`Authorization: token <key>:<secret>`. La clave es el identificador público; el
secreto se devuelve **una sola vez** al crearla y se guarda como digest
`sha256:<64 hex>`, nunca en claro ni en una respuesta posterior.

| Ruta | Función |
|---|---|
| `GET /api/auth/api-keys` | Lista las claves de la cuenta, sin el digest. |
| `POST /api/auth/api-keys` | Emite una clave; `201` con `{id, key, secret, expires_at}`. |
| `DELETE /api/auth/api-keys/{id}` | Revoca una clave; `204`. |

Una clave deshabilitada o caducada se rechaza en cada petición. Las filas
antiguas con un hash `$argon2...` se aceptan y se reescriben con el digest
SHA-256 en el primer uso correcto. La clave de otra cuenta responde `404`, igual
que un identificador inexistente.

Una clave de API válida queda **exenta** de CSRF: un atacante cross-site no
puede adjuntar esa cabecera sin conocer el secreto. Las cuotas por clave
—peticiones por minuto, tamaño— **no** las aplica Ferris: si las necesitas, van
en la pasarela o el proxy delante del proceso.

## OAuth

Ferris implementa **OAuth2 + userinfo**, no OpenID Connect. Los proveedores se
declaran como array; con al menos uno, el servidor monta `/api/oauth/*`, y sin
ninguno esas rutas no existen y el login local sigue funcionando.

```toml
[[auth.oauth.providers]]
name = "google"
client_id = "1234567890.apps.googleusercontent.com"
client_secret = "secreto-del-proveedor"
auth_url = "https://accounts.google.com/o/oauth2/v2/auth"
token_url = "https://oauth2.googleapis.com/token"
user_info_url = "https://openidconnect.googleapis.com/v1/userinfo"
scopes = ["openid", "email", "profile"]
require_verified_email = true
```

| Ruta | Función |
|---|---|
| `GET /api/oauth/providers` | Lista los proveedores montados. |
| `GET /api/oauth/{provider}/login` | Inicia el flujo; acepta `?next=/ruta-local`. |
| `GET /api/oauth/{provider}/callback` | Canjea el código y abre sesión. |

Detalles que no son configurables:

- **PKCE S256 está forzado.** No hay modo `plain` ni forma de desactivarlo.
- El `redirect_uri` se construye desde `server.external_url`:
  `${external_url}/api/oauth/{name}/callback`. Sin `external_url`, se usa el
  bind local, que el proveedor rechazará detrás de un proxy.
- Un `id_token` **no se valida**: no hay firma JWKS ni comprobación de
  `iss`/`aud`/`nonce`/`exp`. Configurar `oidc = true` en un proveedor detiene el
  arranque en vez de ignorar el token en silencio; el flujo es OAuth2 con
  userinfo.
- `require_verified_email` vale `true` por defecto: si el userinfo no trae
  `email_verified: true`, el login se rechaza. Un proveedor solo puede optar por
  no exigirlo de forma explícita.
- El `email` por sí solo no identifica una cuenta. El `sub` estable del
  proveedor se vincula a `User.oauth_subject` en el primer login y un `sub`
  distinto para la misma cuenta se rechaza.
- El `state` se persiste en `tab_oauth_state` (un solo uso, TTL de 600 s) y una
  cookie del navegador lo ata a este cliente. Como el estado vive en la base,
  el callback puede aterrizar en **otra réplica**. El lock del manager no se
  mantiene durante las llamadas HTTP al proveedor.
- `next` solo acepta una ruta local; una URL absoluta se descarta.

El callback no devuelve tokens del proveedor al navegador: abre una sesión
Ferris normal por `AuthSession::login` (cookie + CSRF) y redirige. El
`client_secret` se redacta en `config show` y en los `Debug` de `OAuthProvider`.
Una cuenta con MFA no puede entrar por OAuth: el proveedor solo prueba el primer
factor.

## Varias réplicas

El estado que decide un login no vive en la memoria del proceso:

- El bloqueo por cuenta se persiste en `failed_login_attempts` / `locked_until`
  de la fila del usuario.
- El paso TOTP gastado se persiste en `mfa_last_step`, con una escritura
  condicional atómica.
- El `state` de OAuth vive en `tab_oauth_state`.
- La instantánea de `User Permission` se recarga cada **30 segundos** en cada
  instancia. Una escritura en otra réplica tarda como mucho esa ventana en
  verse; mientras tanto sigue aplicando la instantánea anterior. Un refresco
  fallido conserva la última buena y registra el error.

## Qué no hace esta sección

- No hay registro público de usuarios: las cuentas se crean por invitación o
  desde administración.
- No hay rate limiting general por IP ni cuotas por clave de API; el único
  límite de autenticación es el bloqueo por cuenta (y el limitador del flujo de
  recuperación).
- No hay SSO SAML ni OIDC con validación de `id_token`; OAuth2 con PKCE y
  userinfo es el mecanismo soportado.
- No hay expulsión automática de la sesión más antigua al superar
  `max_sessions_per_user`: el login extra se rechaza.

Para el contrato de las rutas y los códigos de error, consulta
[Autenticación de la API](/api/autenticacion/).
