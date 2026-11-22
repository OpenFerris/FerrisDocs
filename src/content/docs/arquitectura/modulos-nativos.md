---
title: Módulos nativos
description: Cómo ferris-api define el contrato Module, cómo una vertical implementa sus rutas y cómo el servidor las compone sin que la API conozca la feature.
---

`ferris-api` es la fachada REST genérica y el **contrato de módulos nativos**.
No conoce `ferris-print`, `ferris-report` ni ninguna otra vertical. Cada feature
implementa el trait `Module` en su propio crate y `ferris-server` la compone al
arrancar.

Esto no es una separación cosmética: es la condición para que una feature sea
opcional de verdad, para poder probarla aislada y para que un futuro repo de
features no obligue a la API a depender de él.

## Dirección de dependencias

```text
ferris-core / schema / document / auth
              ▲
         ferris-api        ← trait Module, ModuleState, REST genérica
              ▲
   ferris-print, ferris-report, …   ← implementan Module (feature `http`)
              ▲
        ferris-server      ← composition root: los conoce y los monta
```

La flecha nunca se invierte. Un test de `ferris-api` lee su `Cargo.toml` y falla
si vuelve a aparecer una dependencia directa a `ferris-print`,
`ferris-report` o `ferris-realtime`.

## El contrato

```rust
#[async_trait]
pub trait Module: Send + Sync {
    fn name(&self) -> &'static str;
    fn order(&self) -> ModuleOrder;                 // Core | Vertical

    fn register_doctypes(&self);
    fn register_workspaces(&self) -> WorkspaceRegistration;
    fn register_methods(&self, methods: &MethodRegistry);

    fn mount(&self) -> &'static str;                // "/api" por defecto
    fn routes(&self) -> Router<ModuleState>;
    fn public_mount(&self) -> &'static str;         // "/" = sin rutas públicas
    fn public_routes(&self) -> Router<ModuleState>;
    fn openapi(&self) -> OpenApiFragment;

    async fn boot(&self, ctx: &ServiceContext) -> Result<()>;
    async fn shutdown(&self, ctx: &ServiceContext);
}
```

- **`ModuleState`** contiene `Arc<ApiState>` y `AuthState`. Un handler sigue
  extrayendo `State<Arc<ApiState>>` o `AuthenticatedUser`; el estado del módulo
  los resuelve con `FromRef`. No ve Leptos, el plugin store ni el servicio de
  ficheros.
- **`mount()` + rutas relativas.** `PrintModule` declara `mount() = "/api"` y
  rutas `/print/...`; el host las anida y la URL pública sigue siendo
  `/api/print/...`.
- **`openapi()`** devuelve las rutas completas (`/api/print/...`) que el host
  fusiona en `/api/openapi.json`. El router y la documentación salen del mismo
  registro.
- **`ModuleRegistry`** ordena los módulos (`Core` antes que `Vertical`) para que
  el montaje y el documento sean deterministas, y arranca/para el ciclo de vida
  en orden inverso.
- **Las rutas públicas** (`public_mount` distinto de `/`) se montan **antes** de
  las capas de auth. Es el hueco de una descarga firmada: el handler valida su
  propia firma y no debe pasar por `require_auth`. El prefijo `/` está reservado
  para que un módulo no pueda registrar un catch-all delante del servidor.

## Seguridad: la pone el host, no el módulo

Un módulo **no monta** su propia autenticación ni su CSRF. El servidor anida su
router dentro de las mismas capas que la API genérica:

- `require_auth_or_device` y `bind_client_identity` envuelven el router de API
  completo en `ferris-server`;
- `require_csrf` se aplica dentro de `api_router_with_modules`, antes de resolver
  el estado.

La consecuencia práctica: una ruta de módulo sin autenticación responde `401`
igual que `/api/resource/...`; una mutación con cookie exige el token CSRF. Si un
módulo pudiera montar su propio router en la raíz, podría saltarse la política,
así que el contrato no lo permite.

## Ciclo de vida

`ServiceContext` lleva lo que un módulo necesita para arrancar: `Db`, `AuthState`,
`Arc<Config>`, `FeatureFlags` y los roles activos (`api`, `web`, `realtime`,
`worker`, `scheduler`). No lleva Leptos, el plugin store ni tipos del
servidor.

El orden es:

1. `ferris-server` construye el registro antes del bootstrap de authz, para que
   los DocTypes que declaran las verticales entren en la misma instalación de
   políticas.
2. `ModuleRegistry::boot` arranca cada módulo en orden. Un fallo es fatal: el
   proceso no sirve un rol que no pudo preparar.
3. `build_router` monta las rutas, los métodos y el OpenAPI.
4. Al parar el listener, `ModuleRegistry::shutdown` recorre los módulos en orden
   inverso.

`FilesModule` es el ejemplo completo: `boot` construye el store y el servicio de
descargas firmadas; si el store no se puede abrir, deja las rutas ausentes (404)
en vez de tumbar el proceso. Sus rutas de API y su ruta pública usan el mismo
servicio, y `register_methods` instala el base `files.list` que una app puede
sobrescribir.

## Puertos y handles

Un módulo no debe depender de `ferris-jobs` ni de `ferris-email` para encolar un
trabajo o enviar un correo: eso invertiría la dirección del grafo. El contrato
vive en `ferris_core::ports` y el host lo instala una vez:

- `QueuePort` recibe un `JobRequest` (`job_type`, `payload`, `queue` opcional).
  `ferris_jobs::ports::JobQueuePort` lo adapta a la cola real; el adaptador
  persiste/encola y no expone Redis ni SQL al módulo.
- `MailerPort` recibe un `EmailMessage` neutro. El host lo implementa con el
  `email` hub (`EmailHubMailer`), que encola en la misma cola que el worker de
  email; un módulo nunca ve credenciales SMTP.
- `ServiceHandles` es la bolsa tipada que viaja en `ServiceContext.handles`. Cada
  slot es `OnceLock`: la primera instalación gana, así que un segundo boot o un
  hot reload no sustituye el servicio vivo. `queue()`/`mailer()` devuelven
  `Option<Arc<dyn …>>`.

El composition root construye la cola por defecto y el mailer **antes** de
`modules.boot`, para que un módulo pueda usarlos en su arranque. Los puertos son
la pieza que faltaba para mover el runtime de email/integrations fuera del
servidor; el traslado en sí sigue pendiente.

## El puerto de notificaciones

`ferris-api` no llama a `ferris-realtime` para publicar cambios de documento:
publica por `ferris_api::notify::Notifier`.

- el sink por defecto es un no-op;
- `ferris-server` instala un adaptador que reenvía a `ferris_realtime` cuando la
  feature `realtime` está compilada y el rol está activo;
- una escritura confirmada no falla porque un socket no esté disponible: el
  adaptador registra el error y sigue.

## Estado de la migración

| Vertical | Declaraciones | Rutas | Ciclo de vida |
|---|---|---|---|
| `files` | sí | API + pública firmada | sí (store + descargas) |
| `print` | sí | API | no-op |
| `report` | no-op | API | no-op |
| `email` | sí | — | el runtime (hub/worker) sigue en el servidor |
| `integrations` | sí | — | el runtime (hooks/webhooks) sigue en el servidor |
| `realtime`, `jobs`, `scheduler` | — | — | arranque en el servidor |

`email` e `integrations` comparten la cola de trabajos y el mailer con el host.
Los puertos `QueuePort`/`MailerPort` y `ServiceHandles` ya existen y están
instalados; falta mover su runtime para consumirlos y retirar el wiring directo
del servidor. `realtime` necesita devolver una capa de socket al router, y
`jobs`/`scheduler` exponen handles que la observabilidad lee: son servicios, no
módulos HTTP, y el ciclo de vida ya tiene el hueco para cuando se les dé un
contrato de handles específico.

Los permisos de documento no se duplican en el módulo: siguen en la metadata del
DocType y en el `Authorizer` central. Un módulo declara rutas; no una segunda
política de permisos. Las extensiones de UI todavía se registran por el catálogo
global; es el siguiente bloque declarativo que puede entrar en el trait.

## Añadir una feature

1. Implementa la lógica en el crate de la vertical. El motor no depende de HTTP.
2. Expón un módulo detrás de una feature `http` (así una persona que solo quiere
   el motor no arrastra `ferris-api` ni axum):

   ```toml
   [features]
   default = []
   http = ["dep:ferris-api", "dep:axum", ...]
   ```

3. Implementa `Module` con `name`, `register_doctypes`, `register_workspaces`,
   `mount`, `routes`, `openapi` y, si arranca algo, `boot`/`shutdown`.
4. Añade una línea en `ferris-server/src/router/modules.rs`, bajo el `cfg` de la
   feature y el switch `[features]`:

   ```rust
   #[cfg(feature = "print")]
   if features.print {
       modules.push(Arc::new(ferris_print::PrintModule));
   }
   ```

5. Prueba el handler en la vertical y el montaje real en `ferris-server`. El test
   de composición comprueba que la ruta responde, que sin autenticación da `401`
   y que su path aparece en `/api/openapi.json`.

Hoy el contrato lo implementan `ferris-print` y `ferris-report`; el resto de
verticales conserva su propio montaje. `jobs` y `scheduler` no encajan en
`routes()`: necesitan un ciclo de vida (`boot`/`shutdown`) que el trait no
expone, así que no se fuerzan a un router.

## Qué sigue siendo framework

No todo debe ser un módulo. La API genérica de documentos, metadatos, permisos,
sesión/MFA/OAuth, Desk, notificaciones, JSON-RPC, GraphQL y Batch son el núcleo y
siguen en `ferris-api`. Un módulo aporta **superficie de una vertical**, no una
segunda implementación de esas políticas.

La frontera es la misma que en WASM: el host define el marco y las reglas; la
app o el módulo aportan su declaración. La diferencia es que un módulo nativo
comparte proceso y base de datos, y una app WASM corre en el sandbox.
