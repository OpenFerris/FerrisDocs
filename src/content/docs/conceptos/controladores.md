---
title: Controladores y hooks
description: Cómo enganchar lógica de negocio al ciclo de vida de un documento y dónde están los límites.
---

En Ferris no se escribe un "controlador" como clase aparte: se registra una
función en el registro de hooks indicando **DocType + punto + prioridad**. El
motor la ejecuta en el orden que describe
[ciclo de vida](/arquitectura/ciclo-de-vida/), tanto si la escritura vino de la
API como si vino del CRUD tipado.

## Las piezas

```rust
pub type HookFn = Box<
    dyn Fn(&mut HookContext, &mut dyn DocumentHook)
        -> Pin<Box<dyn Future<Output = Result<()>> + Send>>
        + Send + Sync,
>;

pub struct HookRegistry { /* ... */ }
```

- **`HookContext`** — quién y dónde: `doctype`, `docname`, `user`, `request_id`
  opcional y un `metadata` libre (`HashMap<String, Value>`).
- **`DocumentHook`** — el documento en sí: `get_field`, `set_field`, `docstatus`,
  `owner`, `is_new`, …
- **`HookPoint`** — cuándo.
- **`HookFn`** — la función.

`ferris_core::hooks::Hook` también existe como trait, pero el registro almacena
closures: un hook se registra con una función, no implementando un trait.

## Registrar

```rust
use ferris_core::hooks::{HookPoint, HookRegistry};
use ferris_core::Value;

HookRegistry::register_global(
    "ToDo".to_string(),
    HookPoint::BeforeInsert,
    Box::new(|_ctx, doc| {
        if doc.get_field("title") == Some(&Value::from("hook-me")) {
            doc.set_field("status".to_string(), Value::from("hooked"));
        }
        Box::pin(async { Ok::<(), ferris_core::Error>(()) })
    }),
    0,      // prioridad
    None,   // condición opcional
);
```

- `register_global` añade una entrada.
- `replace_global(tag, …)` sustituye la entrada del mismo
  `(tag, doctype, point)`. Es lo que usan los plugins y el dev-server: sin el tag,
  cada recarga apilaría una copia y el hook correría dos veces.
- La **condición** es un `Fn(&HookContext, &dyn DocumentHook) -> bool` que se
  evalúa antes de llamar. Si devuelve `false`, la entrada no se ejecuta.

El orden es **prioridad descendente**; a igual prioridad, orden de inserción.

:::tip[Idempotencia]
Si el registro puede ejecutarse más de una vez en el mismo proceso (tests,
recarga en caliente, arranque repetido), usa `replace_global` con un tag estable.
`register_global` es append-only: añade una entrada nueva sin tocar las demás.
:::

## Qué se puede escribir en un hook

El documento que recibe el hook es `&mut dyn DocumentHook`, y lo que escribas se
persiste: al terminar, el motor reconstruye el `Value` desde ese mapa. Por eso los
puntos `Before*` son los que sirven para calcular campos.

```rust
// Normaliza antes de que la validación de esquema mire el campo.
HookRegistry::replace_global(
    "normalize-email",
    "Contact".to_string(),
    HookPoint::BeforeValidate,
    Box::new(|_ctx, doc| {
        if let Some(email) = doc.get_field("email").and_then(Value::as_str) {
            doc.set_field("email".to_string(), Value::from(email.trim().to_lowercase()));
        }
        Box::pin(async { Ok::<(), ferris_core::Error>(()) })
    }),
    0,
    None,
);
```

### `Validate`

Aquí van los invariantes de negocio: "si `status == Paid`, `paid_at` no puede ser
nulo", "el total debe ser la suma de las líneas". Devuelve
`Error::Validation(ValidationError::…)` y la escritura se aborta con `400`.

`BeforeValidate` existe para **rellenar** lo que la validación exigirá;
`Validate` es para **comprobar**. Confundirlos produce un 400 que el autor no
entiende, porque el campo que falta lo iba a calcular el propio hook.

### `BeforeSave` y `OnSubmit`

`BeforeSave` corre antes de escribir una actualización (también en el amend a
draft). `OnSubmit` corre después de persistir el submit, así que el documento ya
es la verdad almacenada.

```rust
HookRegistry::replace_global(
    "invoice-stamp",
    "Invoice".to_string(),
    HookPoint::OnSubmit,
    Box::new(|ctx, doc| {
        // Un hook puede leer el contexto (usuario, docname) y escribir el documento.
        doc.set_field("submitted_by".to_string(), Value::from(ctx.user.clone()));
        Box::pin(async { Ok::<(), ferris_core::Error>(()) })
    }),
    0,
    None,
);
```

:::caution[Un post-hook no revierte]
Un error en un punto posterior a la escritura no deshace la fila: ya está
confirmada. Si necesitas que un fallo aborte, el hook tiene que ser `Before*`.
:::

## `BeforeNaming` y rename

`BeforeNaming` corre antes de que el motor acuñe el `name`. Si el hook escribe
`name`, el motor lo respeta y no acuña nada:

```rust
Box::new(|_ctx, doc| {
    let slug = doc.get_field("slug").and_then(Value::as_str).unwrap_or("doc");
    doc.set_field("name".to_string(), Value::from(slug.to_string()));
    Box::pin(async { Ok::<(), ferris_core::Error>(()) })
})
```

Para rename hay dos puntos, no uno:

| Punto | Contexto |
|---|---|
| `BeforeRename` | `docname` = nombre **viejo**; metadata `old_name` y `new_name`. |
| `AfterRename` | `docname` = nombre **nuevo**; la misma metadata. |

El documento solo puede llevar un nombre a la vez, por eso los dos viajan en
`HookContext.metadata` y no en los campos.

## Hooks globales y el usuario ambiente

`HookContext.user` es el `id` del usuario de la operación, o **vacío** si la
escritura fue anónima. Un contexto anónimo se declara como tal; no se rellena con
`"Administrator"`, porque eso daría a cualquier hook global un autor
privilegiado para una petición que nadie hizo.

Un hook que necesite el usuario completo (roles, email) puede usar
`ferris_document::current_user()`, que devuelve el `Option<User>` del ámbito
`with_user` en el que corre la petición.

## Límites

- **No hay estado por petición en el registro**: el registro es procesal. Si un
  hook necesita datos de la petición, van en `HookContext.metadata`.
- **El registro se bloquea para leer y se libera antes del `await`**, así que un
  hook lento no bloquea a los demás lectores, pero sí la operación en curso.
- **`OnChange` corre como mucho una vez por save**, a nivel de documento. No hay
  metadata de `on_change` por campo todavía.
- **No hay hooks por campo** más allá de los puntos de documento.
- **Un hook que hace I/O bloquea la escritura**: el trait no es async por
  documento, aunque el future sí lo sea; usa el runtime con cuidado y no retengas
  locks `std::sync` a través de un `.await`.

## Reenvío a WASM

Los plugins no registran `HookFn` en Rust: el host registra **un hook global por
`(doctype, punto)`** con el tag `ferris-plugin`, que traduce el punto a un evento
kebab-case y llama a `doctype-event` del guest. Los `Before*` son síncronos: si el
guest devuelve error, la escritura se aborta. Los post-hooks solo observan.

Un plugin que escribe en su propio DocType puede pedir que no se le reenvíe el
evento (`docstore::write-no-events`), lo que activa
`HookContext::suppress_events` y evita el bucle de reentrada sin silenciar al
resto de hooks globales.

La tabla completa punto → evento está en
[ciclo de vida](/arquitectura/ciclo-de-vida/#cómo-se-reenvía-a-wasm).
