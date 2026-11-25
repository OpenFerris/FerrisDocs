---
title: El viaje de una petición HTTP
description: De axum al motor de documentos y a SQL, con las capas de autenticación, CSRF y permisos en su sitio real.
---

Esta página sigue una petición `PUT /api/resource/ToDo/TODO-1` desde que entra en
el proceso hasta que se escribe la fila. Los nombres son los del código:
`ferris-server/src/router/build.rs` construye el router, `ferris-api` resuelve la
ruta y `ferris-document` ejecuta la escritura.

## 1. Capas globales

`build_router` fusiona en un solo `Router` los roles que la configuración pide
(`api`, `web`, `realtime`, `files`, `wasm`) y aplica las capas globales. En axum
**la última `.layer()` es la más externa**, así que el orden efectivo de fuera
hacia dentro es:

```text
CORS  →  record_request  →  socket.io (solo si realtime)  →  security_headers
      →  TraceLayer / TimeoutLayer / RequestBodyLimitLayer  →  despacho de ruta
```

- **CORS** envuelve todo, incluido `/socket.io`, para responder preflights antes
  de entrar.
- **`record_request`** mide y registra cada petición terminada, también el 404 y
  el 504, porque está por fuera de `require_auth`.
- **`security_headers`** añade CSP con nonce por respuesta, `X-Frame-Options`,
  `nosniff`, `Referrer-Policy` y HSTS. También cubre el fallback, así que un 404
  sale con la cabecera completa.
- **Timeout y límite de body** vienen de `settings.request_timeout_secs` y
  `settings.body_limit_mb`; un timeout responde `504`.

Después viene el despacho. `/health`, las rutas públicas de sesión
(`/api/auth/login`, `/api/auth/session`, `/api/auth/mfa/verify` y
`/api/auth/logout`, esta última con CSRF), `/files/{*path}` (descarga firmada) y
`/api/oauth/*` son públicos por diseño. Todo lo demás pasa por la capa de
autenticación; el MFA autoservicio (`/api/auth/mfa/enable|activate|disable`) vive
**dentro** del router autenticado.

## 2. Autenticación, CSRF y usuario ambiente

El sub-router de la API se monta con tres capas, de fuera hacia dentro:

```text
bind_client_identity  →  require_auth_or_device  →  bind_ambient_user  →  require_csrf  →  handler
```

- **`bind_client_identity`** extrae los datos del certificado de cliente ya
  verificado (mTLS) y los deja en las extensiones de la petición.
- **`require_auth_or_device`** acepta la cookie de sesión o una clave de API. Acepta además un
  certificado verificado **solo** en `/api/method/*`: en `/api/resource/*` un
  certificado nunca sustituye a un rol.
- **`bind_ambient_user`** resuelve el usuario opcional y ejecuta el resto dentro
  de `ferris_document::with_user`. Sin usuario, el motor queda sin identidad y
  deniega (fail-closed); un dispositivo autenticado por certificado no tiene
  sesión, así que entra en ese caso.
- **`require_csrf`** es interno al router de la API: con autenticación por cookie
  de sesión, toda ruta mutante exige `X-CSRF-Token`. Las claves de API y
  `GET`/`HEAD`/`OPTIONS` están exentos. `/api/auth/login` y
  `/api/auth/mfa/verify` quedan fuera porque todavía no hay sesión que guarde el
  token; `/api/auth/logout` sí lo lleva, con su propia capa.

:::note[Tenant]
No hay middleware de tenant por petición. `TenantConfig`/`TenantManager`
(`ferris-core/src/tenant.rs`) es el registro de arranque que usa `ferris tenant`
en la CLI: un fichero `<root>/<id>.json` por tenant, cacheado por firma de
fichero. Los errores de tenant que sí llegan a una respuesta se mapean a `404`
(`NotFound`) y `409` (`AlreadyExists`).
:::

## 3. El handler

```rust
pub(super) async fn update(
    State(state): State<Arc<ApiState>>,
    Path((doctype, name)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Response {
    match DocStore::update(&state.pool, &doctype, &name, body).await {
        Ok(value) => Json(value).into_response(),
        Err(e) => error_response(e),
    }
}
```

El handler es delgado a propósito: extrae, llama a `DocStore` y traduce el error.
No construye SQL ni decide permisos.

## 4. `DocStore`: metadata efectiva y contexto

`DocStore` vive en `ferris-api/src/store/` y es la fachada que también usa el
puente SSR. Antes de tocar el motor:

1. `validate_doctype` y `validate_name` validan los parámetros de ruta.
2. `effective_meta(pool, doctype)` toma la metadata del registro y le aplica, en
   este orden, `CustomizationStore::apply` (custom fields y property setters) y
   `custom_docperm::apply` (overrides de `Custom DocPerm`).
3. `context(...)` construye el `EngineContext` con esa metadata, el
   `naming_type` efectivo del DocType y `ferris_document::current_user()`.

Ese `current_user()` es el que puso `bind_ambient_user`. De ahí sale el `owner`
en un insert y el sujeto de toda decisión de permisos.

## 5. `DocumentEngine`: autorizar, validar, escribir

Dentro del motor, el orden ya está descrito en
[ciclo de vida](/arquitectura/ciclo-de-vida/). Lo relevante para una petición:

- **Permisos antes de hooks.** `self.authorize(...)` se ejecuta antes de
  `BeforeValidate` para que un llamante sin `Write` no pueda provocar efectos ni
  distinguir 400 de 403.
- **Permisos de campo después.** Un campo con `permlevel` que el llamante no
  alcanza se elimina del body; un `Password` se hashea; un `Secret` se cifra.
- **Validación en el medio.** `validate(meta, &document)` aplica `reqd`,
  `max_length`, `min_value`/`max_value` y las reglas del fieldtype.
- **Un solo `WriteSink`.** `Db` para una escritura suelta, `Tx` para un batch. El
  mismo camino escribe la fila, la versión y el contador de naming.

## 6. `ferris-db`: SQL y clasificación de errores

El motor no escribe SQL a mano salvo en contadas excepciones; construye `Stmt`
con valores ligados y cita identificadores con
`Ident::new(name)?.quote(dialect)`. `Db` lleva su `Dialect`, así que el SQL se
escribe para el backend real y no hay forma de olvidar cuál es.

Los errores del driver se convierten **una sola vez**, en
`ferris-db/src/error.rs::classify`, en `DatabaseError::{Constraint,
PoolExhausted, Query}`. Por eso el motor puede traducir una violación de unicidad
a `DocumentError::AlreadyExists` sin leer el texto del mensaje.

## 7. La respuesta y los errores

`error_response` es el único mapeo de `ferris_core::Error` a estado HTTP:

| Error | Estado |
|---|---|
| `DocumentError::NotFound`, `SchemaError::DocTypeNotFound` | `404` |
| `Validation`, `AuthzError::InvalidPolicy` | `400` |
| `DocumentError::AlreadyExists`, `WorkflowError::AlreadyExists`, `SchemaError::DuplicateField` | `409` |
| `AuthError::TooManySessions` | `429` |
| `AuthError(_)` | `401` (sin `WWW-Authenticate`) |
| `Authz(_)` | `403` |
| `SingleNotCreatable` / `SingleNotDeletable` | `405` |
| `JobError::Timeout` | `504` |
| resto | `500` |

Un `4xx` conserva su mensaje, porque describe la entrada del llamante. Un `5xx`
**no**: se registra en el log con el error completo (SQL, rutas, tablas) y la
respuesta dice solo `internal error`.

## 8. SSR vs hydrate

El Desk consume los mismos datos por dos caminos y una sola definición:

```text
SSR      : petición HTTP → web_auth_guard → Leptos → DocStore::Server ─┐
                                                                        ├─▶ effective_meta / DocumentEngine
hydrate  : navegador → DocStore::Client → /api/doctype/meta, /api/resource┘
```

- `web_auth_guard` envuelve todo el router del Desk: una `/desk/...` sin sesión
  responde `302 /login?next=…`, y un `/login` ya autenticado vuelve al desk.
  También resuelve el usuario para que el SSR pinte la identidad real.
- Las vistas no llaman a `fetch` ni a `reqwest`: usan la fachada
  `ferris-web/src/api/store.rs` (`DocStore::Server` o `DocStore::Client`). Eso es
  lo que mantiene la paridad: si el servidor y el navegador hablaran por caminos
  distintos, una pantalla podría autorizar distinto que la otra.
- `effective_dyn_meta` es la función que usan el handler
  `GET /api/doctype/meta/{doctype}` y el puente SSR, así que ambos reciben el
  mismo payload byte a byte.

## 9. Por qué una sola ruta para tipado y dinámico

`POST /api/resource/ToDo` y `ToDo::insert(&db)` acaban en
`DocumentEngine::create`. No hay una ruta "rápida" para los tipos compilados ni
un `Resource` alternativo: si existieran dos, la segunda se saltaría algo —un
hook nuevo, un permiso de campo, el sello de `modified`— y nadie lo notaría hasta
producción.

La consecuencia práctica para quien extiende el framework: **un cambio de
comportamiento se hace en el motor**, no en el handler.
