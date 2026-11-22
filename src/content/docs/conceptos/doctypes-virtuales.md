---
title: DocTypes virtuales
description: DocTypes cuyas filas viven fuera de las tablas de documentos, servidas por un proveedor registrado.
---

Un **DocType virtual** (`is_virtual = true`) se declara como cualquier otro
—campos, permisos, flags— pero no tiene tabla. El motor le pasa cada operación a
un proveedor registrado, que es el dueño real de los datos. Es la forma de exponer
una fuente externa (una API, un almacén propio, un directorio LDAP) con la misma
metadata, el mismo Desk y el mismo sistema de permisos que un DocType normal.

## Declaración

```rust
DoctypeMeta::new("GithubIssue", "Integrations")
    .description("Issues leídos de la API de GitHub.")
    .virtual_doctype()
    .field(FieldMeta::data("title").required().in_list_view())
    .field(FieldMeta::data("state").in_list_view())
    .permission(PermissionRule {
        role: "Desk User".to_string(),
        read: true,
        ..Default::default()
    })
```

Con la macro: `#[doctype(name = "GithubIssue", module = "Integrations", is_virtual = true)]`.

`is_virtual` viaja al Desk en `DynMeta.is_virtual`; el frontend no ofrece crear ni
editar, y `offers_create` devuelve `false` sin mirar siquiera los permisos.

## El proveedor

```rust
pub trait VirtualDoctypeProvider: Send + Sync {
    fn list(&self, ctx: &EngineContext<'_>, query: &ListQuery) -> Result<Vec<Value>>;
    fn get(&self, ctx: &EngineContext<'_>, name: &str) -> Result<Value>;
    fn create(&self, ctx: &EngineContext<'_>, data: Value) -> Result<Value>;
    fn update(&self, ctx: &EngineContext<'_>, name: &str, data: Value) -> Result<Value>;
    fn delete(&self, ctx: &EngineContext<'_>, name: &str) -> Result<()>;
}
```

Es síncrono por la misma razón que los campos virtuales: una firma async
obligaría a `async_trait` o a futures escritos a mano en cada implementación. Un
proveedor que haga I/O bloquea en su propio runtime.

Registro, idempotente:

```rust
use std::sync::Arc;
use ferris_document::{register_virtual_doctype, VirtualDoctypeProvider};

register_virtual_doctype("GithubIssue", Arc::new(GithubProvider::new(token)));
```

Re-registrar el mismo DocType **sustituye** el proveedor. Es lo que necesita un
dev-server que recarga la app sin filtrar el anterior.

## Quién decide qué

La división es estricta y conviene tenerla clara:

| Decisión | Quién |
|---|---|
| ¿Puede el llamante ejecutar esta acción? | El **motor**, antes de llamar al proveedor. |
| ¿Qué filas hay, cómo se filtran y se ordenan? | El **proveedor**. |
| ¿Cómo se llama la fila? | El **proveedor**. |
| Validación declarativa y campos virtuales | El **motor**, sobre lo que devuelve el proveedor. |

El motor autoriza con `Permission::{Read, Create, Write, Delete}` contra las
reglas del DocType. Si tu backend tiene control de acceso por fila más fino que
la metadata, el proveedor lo aplica dentro de `list`/`get`.

`list` recibe el mismo `ListQuery` que el camino SQL y se encarga de filtrar,
ordenar y paginar. El motor informa como `total` el número de filas que devolvió el
proveedor.

## Naming: lo pone el proveedor

El motor **no acuña** un nombre para un DocType virtual. Un provider que devuelve
un documento sin `name` recibe:

```text
ValidationError::Invalid("the provider for virtual DocType `X` returned a document without a `name`")
```

Inventar uno aquí crearía un identificador que el proveedor no sabría resolver en
la siguiente lectura. `create_owned_by` tampoco se admite: el `owner` pertenece al
proveedor, y la operación devuelve un error explicando que no está soportada.

## Recorrido de cada operación

```text
get(name)     → authorize(Read)   → provider.get(name)   → virtual_read(...)
list(query)   → authorize(Read)   → provider.list(query) → virtual_read por fila
create(data)  → authorize(Create) → provider.create(data) → finish_virtual_write
update(name)  → authorize(Write)  → provider.update(...)  → finish_virtual_write
delete(name)  → authorize(Delete) → provider.delete(name)
```

`finish_virtual_write` exige que el resultado tenga `name` y le aplica
`virtual_read`, así que un campo virtual también funciona sobre un DocType virtual.

Ninguna de estas rutas toca una tabla `tab<DocType>`, ni la versión, ni el
contador de naming.

## Por qué `apply` los rechaza

`DocumentEngine::apply` promete **atomicidad de lote**: todas las operaciones en
una transacción, o ninguna. Un DocType virtual no comparte esa transacción —su
proveedor posee el almacenamiento y puede no ser reentrante—, así que delegar op
por op perdería en silencio la garantía. Por eso el motor lo rechaza de frente:

```text
400 `X` is a Virtual DocType; `apply` cannot batch it because its provider owns storage
```

La alternativa sería fingir atomicidad, que es peor. Si necesitas un lote sobre un
virtual, el proveedor debe exponer su propia operación de lote.

`create_bulk` tiene un comportamiento distinto y documentado: para un DocType
virtual delega cada cuerpo a `create` de forma secuencial y **no** promete
atomicidad.

## Cuándo usarlo

- Datos que ya viven en otro sistema y no quieres copiar (issues, contactos de un
  directorio, métricas).
- Una fuente de solo lectura que quieres en el Desk con búsqueda, lista y permisos
  sin escribir un endpoint a medida.
- Un DocType cuyo almacenamiento necesita una transacción o un protocolo que
  `ferris-db` no cubre.

## Cuándo no

- Si necesitas que el documento participe de un `apply` atómico con otros.
- Si necesitas historial (`tab_version`) automático: un virtual no lo tiene.
- Si el volumen obliga a paginar en SQL: el proveedor tendrá que paginar por su
  cuenta, y el motor no puede ayudarte con índices.

:::note[Permisos de campo y virtuales]
Los campos virtuales de un DocType virtual se calculan sobre lo que devuelve el
proveedor, y la redacción por `permlevel` se aplica igual. Un proveedor no puede
saltarse el nivel de permiso devolviendo el campo ya calculado: el motor lo
elimina después.
:::
