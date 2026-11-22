---
title: Autenticación (configuración)
description: JWT, sesiones, CSRF, política de contraseñas, MFA y proveedores
  OAuth en la sección [auth].
slug: 0.2/configuracion/autenticacion
---

`[auth]` reúne el secreto de firma de tokens, la caducidad, la política de
contraseñas, el segundo factor y los proveedores OAuth que el Desk puede usar
para iniciar sesión.

```toml
[auth]
jwt_expiry_hours = 24
refresh_expiry_days = 30
password_min_length = 8
mfa_enabled = false
```

El `jwt_secret` **no** se escribe aquí en producción. Se inyecta por entorno:

```bash
export FERRIS_JWT_SECRET="$(openssl rand -hex 32)"
```

## Campos

| Clave | Tipo | Por defecto | Estado |
|---|---|---|---|
| `jwt_secret` | string | sin definir | Se lee del fichero o de `FERRIS_JWT_SECRET`/`JWT_SECRET`. |
| `jwt_expiry_hours` | u64 | `24` | Se acepta en la configuración; ver limitaciones. |
| `refresh_expiry_days` | u64 | `30` | Se acepta en la configuración; ver limitaciones. |
| `password_min_length` | usize | `8` | Se acepta en la configuración; ver limitaciones. |
| `mfa_enabled` | bool | `false` | Activa el segundo factor en el flujo de login. |
| `[auth.oauth]` | tabla | sin proveedores | Habilita `/api/oauth/*`. |

### El secreto JWT

No existe un valor por defecto utilizable. Si falta, `serve`, `run` y `dev`
fallan al arrancar con un mensaje que nombra `FERRIS_JWT_SECRET`. El secreto
debe tener **al menos 32 caracteres**; uno más corto lo rechaza
`ferris-auth::JwtConfig`.

El marcador `change-me-in-production` es un error duro en la carga de
configuración, no un aviso: con él, cualquiera podría firmar tokens válidos.

```toml
[auth]
# Solo para desarrollo local, nunca en un repositorio compartido
jwt_secret = "una-cadena-de-al-menos-32-caracteres"
```

`ferris config show` imprime `<redacted>` en esa clave, y el `Debug` de
`AuthConfig` también la enmascara.

### Rotación del secreto

```bash
openssl rand -hex 32   # el nuevo FERRIS_JWT_SECRET
```

* Rotarlo invalida **de inmediato** todos los JWT firmados con el anterior
  (tokens bearer y llamadas de API); los clientes deben volver a autenticarse.
* Las sesiones por cookie sobreviven: se resuelven contra la base de datos, no
  contra el JWT.
* No hay `kid` ni solapamiento de dos secretos: la rotación es un corte, no una
  transición. Reinicia todas las réplicas a la vez.
* No derives este secreto del de `[secrets]`; son ciclos de vida distintos y
  rotarlos juntos puede dejar credenciales ilegibles.

:::caution[Limitaciones conocidas]
El servidor construye su `JwtConfig` con `JwtConfig::new(secret)`, que fija
**24 horas** de access token y **30 días** de refresh, y valida contraseñas con
`PasswordConfig::default()`. Hoy `jwt_expiry_hours`, `refresh_expiry_days` y
`password_min_length` se parsean y se transportan, pero no se proyectan sobre
esos dos tipos. No los trates como palancas efectivas hasta que el cableado
cambie. Tampoco hay endpoint de refresh: la sesión por cookie es la vía
principal del Desk.
:::

## Sesiones

El login abre una sesión respaldada en base de datos, no solo un token en
memoria. La cookie se llama `ferris_session`, es `HttpOnly`, `SameSite=Lax` y
se marca `Secure` cuando `[server.tls]` está configurado.

| Ajuste | Valor efectivo |
|---|---|
| Duración de sesión | 60 minutos |
| Sesiones concurrentes por usuario | 5; un login extra se rechaza, no expulsa a la anterior |
| Intentos fallidos antes de bloqueo | 5 |
| Duración del bloqueo | 15 minutos |

Solo los intentos **fallidos** cuentan para el bloqueo; un login correcto limpia
la clave. La cookie no se emite sobre HTTP plano salvo que no haya TLS, que es
el caso de desarrollo.

### Rutas públicas

| Ruta | Método | Función |
|---|---|---|
| `/api/auth/login` | `POST` | Valida credenciales; abre sesión o devuelve un reto MFA. |
| `/api/auth/session` | `GET` | Devuelve la identidad de la sesión actual. |
| `/api/auth/mfa/verify` | `POST` | Completa el reto MFA del login. |
| `/api/auth/logout` | `POST` | Cierra la sesión. Lleva CSRF. |

`login`, `session` y `mfa/verify` quedan fuera de `require_auth` porque son la
forma de entrar. `logout` sí lleva la capa CSRF: un formulario de otro sitio no
debe poder cerrar tu sesión.

### CSRF

Las peticiones autenticadas por **cookie** deben enviar `X-CSRF-Token` con el
valor que entregó el login o `GET /api/auth/session`, en toda ruta mutante. Los
llamadores con `Authorization: Bearer` y los métodos `GET`/`HEAD`/`OPTIONS`
están exentos. La capa vive dentro del router de la API, después de resolver la
sesión, para no autenticar dos veces.

## MFA

`mfa_enabled = true` activa el segundo factor TOTP para los usuarios que lo
tengan habilitado. El login responde con un reto de corta vida (5 minutos) y el
cliente lo completa en `/api/auth/mfa/verify`.

```toml
[auth]
mfa_enabled = true
```

Rutas de autoservicio, autenticadas y con CSRF:

| Ruta | Función |
|---|---|
| `POST /api/auth/mfa/enable` | Genera el secreto y el URI `otpauth://`. |
| `POST /api/auth/mfa/activate` | Confirma el primer código y activa MFA. |
| `POST /api/auth/mfa/disable` | Desactiva MFA para el usuario. |

El emisor del URI es `Ferris`. El código tiene 6 dígitos y paso de 30 segundos
por defecto. La activación es en dos pasos: un usuario no puede quedar con MFA
activo y sin haber probado nunca un código.

## OAuth

Los proveedores se declaran como array. Con al menos uno, el servidor monta
`/api/oauth/*`; sin ninguno, esas rutas no existen y el login local sigue
funcionando.

```toml
[[auth.oauth.providers]]
name = "google"
client_id = "1234567890.apps.googleusercontent.com"
client_secret = "secreto-del-proveedor"
auth_url = "https://accounts.google.com/o/oauth2/v2/auth"
token_url = "https://oauth2.googleapis.com/token"
user_info_url = "https://openidconnect.googleapis.com/v1/userinfo"
scopes = ["openid", "email", "profile"]
```

| Ruta | Función |
|---|---|
| `GET /api/oauth/providers` | Lista los proveedores montados. |
| `GET /api/oauth/{provider}/login` | Inicia el flujo; acepta `?next=/ruta-local`. |
| `GET /api/oauth/{provider}/callback` | Canjea el código y abre sesión. |

Detalles que no son configurables:

* **PKCE S256 está forzado.** No hay modo `plain` ni forma de desactivarlo.
* El `redirect_uri` se construye desde `server.external_url`:
  `${external_url}/api/oauth/{name}/callback`. Sin `external_url`, se usa el
  bind local, que el proveedor rechazará detrás de un proxy.
* El `state` es de un solo uso, vive en una cookie del navegador y caduca a los
  600 segundos.
* `next` solo acepta una ruta local; una URL absoluta se descarta.

El callback no devuelve tokens del proveedor al navegador: abre una sesión
Ferris normal (cookie + CSRF) y redirige. El `client_secret` se redacta en
`config show` y en los `Debug` de `OAuthProvider`.

## Qué no hace esta sección

* No hay registro público de usuarios ni recuperación de contraseña por email.
* No hay política de contraseñas configurable de facto (ver la limitación).
* No hay rate limiting general por IP; el único límite es el bloqueo de login
  por usuario.
* No hay SSO SAML ni OIDC de descubrimiento automático; OAuth2 con PKCE es el
  mecanismo soportado.

Para el contrato de las rutas y los códigos de error, consulta
[Autenticación de la API](/0.2/api/autenticacion/).
