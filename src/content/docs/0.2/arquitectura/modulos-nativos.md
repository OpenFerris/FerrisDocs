---
title: Módulos nativos
description: Cómo ferris-api define el contrato Module, cómo una vertical
  implementa sus rutas y cómo el servidor las compone sin que la API conozca la
  feature.
slug: 0.2/arquitectura/modulos-nativos
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
pub trait Module: Send + Sync {
    fn name(&self) -> &'static str;
    fn order(&self) -> ModuleOrder;          // Core | Vertical
    fn mount(&self) -> &'static str;          // "/api" por defecto
    fn routes(&self) -> Router<ModuleState>;
    fn openapi(&self) -> OpenApiFragment;
}
```

* **`ModuleState`** contiene `Arc<ApiState>` y `AuthState`. Un handler sigue
  extrayendo `State<Arc<ApiState>>` o `AuthenticatedUser`; el estado del módulo
  los resuelve con `FromRef`. No ve Leptos, el plugin store ni el servicio de
  ficheros.
* **`mount()` + rutas relativas.** `PrintModule` declara `mount() = "/api"` y
  rutas `/print/...`; el host las anida y la URL pública sigue siendo
  `/api/print/...`.
* **`openapi()`** devuelve las rutas completas (`/api/print/...`) que el host
  fusiona en `/api/openapi.json`. El router y la documentación salen del mismo
  registro.
* **`ModuleRegistry`** ordena los módulos (`Core` antes que `Vertical`) para que
  el montaje y el documento sean deterministas.

## Seguridad: la pone el host, no el módulo

Un módulo **no monta** su propia autenticación ni su CSRF. El servidor anida su
router dentro de las mismas capas que la API genérica:

* `require_auth_or_device` y `bind_client_identity` envuelven el router de API
  completo en `ferris-server`;
* `require_csrf` se aplica dentro de `api_router_with_modules`, antes de resolver
  el estado.

La consecuencia práctica: una ruta de módulo sin autenticación responde `401`
igual que `/api/resource/...`; una mutación con cookie exige el token CSRF. Si un
módulo pudiera montar su propio router en la raíz, podría saltarse la política,
así que el contrato no lo permite.

## El puerto de notificaciones

`ferris-api` no llama a `ferris-realtime` para publicar cambios de documento:
publica por `ferris_api::notify::Notifier`.

* el sink por defecto es un no-op;
* `ferris-server` instala un adaptador que reenvía a `ferris_realtime` cuando la
  feature `realtime` está compilada y el rol está activo;
* una escritura confirmada no falla porque un socket no esté disponible: el
  adaptador registra el error y sigue.

## Límites actuales

* El trait declara **rutas y OpenAPI**. Los DocTypes, workspaces y extensiones de
  UI siguen el catálogo por crate (`register_doctypes`/`register_workspaces`),
  que ya es una forma de autoregistro; unificarlo en `Module` es el siguiente
  paso, no algo que este piloto haga.
* Los permisos de documento no se duplican en el módulo: siguen en la metadata
  del DocType y en el `Authorizer` central. Un módulo declara rutas; no una
  segunda política de permisos.
* `jobs` y `scheduler` necesitan un ciclo de vida (`boot`/`shutdown`) que el
  trait no expone.

## Añadir una feature

1. Implementa la lógica en el crate de la vertical. El motor no depende de HTTP.

2. Expón un módulo detrás de una feature `http` (así una persona que solo quiere
   el motor no arrastra `ferris-api` ni axum):

   ```toml
   [features]
   default = []
   http = ["dep:ferris-api", "dep:axum", ...]
   ```

3. Implementa `Module` con `name`, `mount`, `routes` y `openapi`.

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
