---
title: Errores
description: Taxonomía de errores de ferris-core por dominio, variantes que importan y cómo llegan a HTTP.
---

Todo error del framework es un `ferris_core::Error`: un enum con una variante por
dominio y un `thiserror` por dominio. `Result<T>` es `Result<T, Error>`. Las
crates de librería devuelven este tipo; `anyhow` queda para los binarios y la
orquestación (CLI, servidor, host wasmtime, `ssr.rs`).

## El enum superior

```rust
pub enum Error {
    Config(ConfigError),
    Database(DatabaseError),
    Tenant(TenantError),
    Auth(AuthError),
    Authz(AuthzError),
    Validation(ValidationError),
    Document(DocumentError),
    Schema(SchemaError),
    Migration(MigrationError),
    Job(JobError),
    Realtime(RealtimeError),
    Email(EmailError),
    File(FileError),
    Search(SearchError),
    Workflow(WorkflowError),
    Serialization(SerializationError),
    Secret(SecretError),
}
```

Cada variante tiene `#[from]`, así que un `?` sobre el error de dominio lo
convierte sin ceremonia.

Dos conversiones externas, clasificadas **una sola vez**:

- `serde_json::Error` → `SerializationError::Json`.
- `std::io::Error` → `FileError::NotFound` si es `NotFound`, y
  `FileError::Storage` en cualquier otro caso. La clase se conserva para que el
  llamador pueda ramificar sin parsear el mensaje.

## Config

| Variante | Cuándo |
|---|---|
| `Missing(String)` | Falta una clave obligatoria o una variable de entorno |
| `Invalid { key, msg }` | El valor existe y no es válido (una feature sin su binario, un rol imposible) |
| `NotFound(String)` | No existe el directorio de configuración |
| `Parse(figment::Error)` | El TOML/YAML fusionado no describe una configuración válida |

## Database

| Variante | Cuándo |
|---|---|
| `Connection`, `Query`, `Transaction`, `Migration` | Fallo del driver, ya clasificado en `ferris-db/src/error.rs` |
| `Constraint(String)` | Violación de constraint (única, FK) |
| `PoolExhausted` | No hay conexión disponible |
| `NotFound` | Una consulta que exigía una fila no devolvió ninguna |

`ferris-db` es el **único** punto que traduce errores del driver a estas
variantes. Un llamador reacciona a `Constraint`, no a un texto.

## Auth y Authz

| Variante | Cuándo |
|---|---|
| `AuthError::InvalidCredentials` | Usuario o contraseña incorrectos |
| `AuthError::TokenInvalid` | Credencial de sesión o clave de API mal formada |
| `AuthError::AccountDisabled` | La cuenta existe y está deshabilitada |
| `AuthError::MfaRequired` | La cuenta debe completar el segundo factor |
| `AuthError::RateLimited` | Demasiados intentos |
| `AuthError::TooManySessions(u32)` | Se alcanzó el tope de sesiones concurrentes |
| `AuthError::OAuthStateMismatch` / `OAuthCodeExchange` | Fallo del flujo OAuth |
| `AuthzError::PermissionDenied { action, resource }` | El caso normal de un `403` |
| `AuthzError::InsufficientRole { required, actual }` | Falta un rol concreto |
| `AuthzError::TenantAccessDenied` | Acceso cruzado entre tenants |
| `AuthzError::InvalidPolicy(String)` | Un documento de política no parsea |

## Validation

| Variante | Cuándo |
|---|---|
| `Field { field, message }` | Un campo concreto no cumple |
| `Required(String)` | Falta un campo obligatorio |
| `InvalidValue { field, message }` | Valor fuera de rango, formato o `options` |
| `Constraint(String)` | Regla de negocio incumplida |
| `Invalid(String)` | Entrada mal formada sin campo asociado |

## Document

Es el dominio más rico, porque cubre escritura, naming, tablas hijas y singles.

| Variante | Cuándo |
|---|---|
| `NotFound { doctype, name }` | No existe el documento |
| `AlreadyExists { doctype, name }` | La clave ya está ocupada |
| `Submitted` / `Cancelled` | El estado no permite la operación |
| `NamingSeriesExhausted(String)` | La serie llegó a su máximo |
| `NameRequired { doctype }` | Naming `prompt` sin nombre |
| `NamingFieldEmpty` / `NamingFieldUndeclared` | Naming `field` mal declarado |
| `NamingScriptUndeclared` | Naming `script` sin proveedor |
| `NamingSeriesMissing` | Campo de serie vacío |
| `RenameNotAllowed { doctype }` | `allow_rename` apagado |
| `VirtualDoctypeProviderMissing` / `VirtualFieldProviderMissing` | Falta el proveedor de un DocType/campo virtual |
| `VirtualFieldReadOnly { doctype, field }` | Intento de escribir un campo virtual |
| `LinkValidation { field, target }` | Declarado para un `Link` que apunta a un destino inexistente; el motor no comprueba esa existencia al escribir. |
| `ChildTable(String)` | Error dentro de una tabla hija |
| `SingleNotCreatable` / `SingleNotDeletable` | `POST`/`DELETE` sobre un Single (HTTP `405`) |
| `NotSingle { doctype }` | Se usó la ruta de Single con un DocType normal |

## Schema

| Variante | Cuándo |
|---|---|
| `DocTypeNotFound(String)` | Nombre desconocido (`404` en la API) |
| `FieldNotFound { doctype, field }` | El campo no está declarado |
| `InvalidFieldType(String)` | `fieldtype` fuera de la lista canónica |
| `CircularReference(String)` | Dependencia circular entre DocTypes |
| `DuplicateField { doctype, field }` | Campo repetido |
| `ReservedDocType(String)` | Un plugin intenta declarar un DocType del framework |
| `DocTypeOwnedBy { name, owner }` | Otro app ya lo declara |
| `DocTypeTableCollision { … }` | Dos DocTypes comparten tabla física |

## Migration

`Failed { version, msg }`, `AlreadyApplied`, `NotFound`, `ChecksumMismatch` y
`DowngradeNotSupported`. Una migración con checksum distinto no se reaplica en
silencio: falla, salvo `--force`, que la degrada a warning.

## Job, Realtime, Email, File, Search, Workflow

| Dominio | Variantes que importan |
|---|---|
| `Job` | `NotFound`, `Failed`, `Timeout` (HTTP `504`), `MaxRetriesExceeded`, `DependencyFailed`, `QueueNotFound`, `Connection` |
| `Realtime` | `Connection`, `RoomNotFound`, `Subscription`, `Serialization`, `Delivery` |
| `Email` | `Smtp`, `NotFound`, `Template`, `Attachment` |
| `File` | `NotFound`, `Upload`, `Storage`, `InvalidType`, `TooLarge { size, limit }` |
| `Search` | `IndexNotFound`, `SearchFailed`, `IndexingFailed`, `Unsupported` |
| `Workflow` | `NotFound`, `InvalidTransition { from, to, action }`, `ConditionNotMet`, `RequiredField`, `ApprovalRequired`, `AlreadyExists` |

`SearchError::Unsupported` existe para que un backend no implementado falle en
vez de degradar en silencio.

## Secret

| Variante | Cuándo |
|---|---|
| `KeyMissing` | No hay clave configurada (`FERRIS_SECRETS__KEY` o `[secrets] key`) |
| `KeyInvalid(String)` | La clave no es válida |
| `RevealNotPermitted` | El contexto no puede revelar el valor |
| `NotSecretField { doctype, field }` | Se pidió revelar un campo que no es `Secret` |
| `NotRecoverable { … }` | El valor se guardó sin cifrado o en otro formato |
| `UnknownKeyId { key_id, … }` | Se cifró con una clave retirada |
| `AuthenticationFailed { … }` | El ciphertext no autentica (clave incorrecta o manipulación) |

## De error a HTTP

El mapeo vive en un solo sitio y se detalla en
[errores y permisos](/api/errores-y-permisos/). Resumen: `NotFound` → `404`,
validación → `400`, conflicto → `409`, auth → `401`, authz → `403`, single →
`405`, timeout de job → `504`, resto → `500` con mensaje redactado.

:::note[Los logs ven más que el cliente]
Un `5xx` registra el error completo con `tracing::error!`; la respuesta dice solo
`internal error`. Depurar un `500` se hace en el log, nunca adivinando por el
cuerpo.
:::
