---
title: Ciclo de vida de un documento
description: Los 19 puntos de hook, su orden exacto en cada operación y cómo se
  reenvían a un plugin WASM.
slug: 0.2/arquitectura/ciclo-de-vida
---

El motor tiene **un solo camino de escritura** para el CRUD tipado y para el
dinámico, así que el orden de los hooks vive en
`ferris-document/src/engine/support/hooks.rs` y no en cada llamante: dos copias
discreparían la primera vez que alguien añadiera un punto.

## Los 19 `HookPoint`

`ferris_core::hooks::HookPoint` declara 19 variantes. `as_str()` devuelve la
grafía snake_case, exactamente la que produce serde (hay un test que las mantiene
iguales).

| Punto | Cuándo |
|---|---|
| `BeforeNaming` | Antes de que el motor acuñe el `name`; un controlador puede fijarlo. Solo insert. |
| `BeforeValidate` | Antes de la validación de esquema; puede rellenar campos que el validador exigiría. |
| `Validate` | Validación de negocio, después de la de esquema. |
| `BeforeInsert` | Último punto antes de escribir la fila nueva. |
| `AfterInsert` | Después del `INSERT`, sobre el documento ya persistido. |
| `BeforeSave` | Antes de escribir una actualización (y antes de un amend a draft). |
| `AfterSave` | Después de escribir la actualización. |
| `OnUpdate` | Después de cualquier escritura de fila; se emite en insert y en update. |
| `BeforeSubmit` | Antes de pasar a `docstatus = 1`. |
| `OnSubmit` | Después de persistir el submit. |
| `BeforeCancel` | Antes de pasar a `docstatus = 2`. |
| `OnCancel` | Después de persistir el cancel. |
| `BeforeDelete` | Antes del `DELETE`. |
| `OnTrash` | Tras confirmar el borrado, con el documento eliminado en memoria. |
| `BeforeUpdateAfterSubmit` | Edición de un documento ya enviado, antes de escribir. |
| `OnUpdateAfterSubmit` | Esa misma edición, después de escribir. |
| `OnChange` | Algún campo no interno cambió; como mucho una vez por save. |
| `BeforeRename` | Antes de mover la clave primaria. |
| `AfterRename` | Después de moverla. |

## Orden en insert

```text
Create (permiso)  →  permisos de campo  →  rechazo de campos virtuales
  →  BeforeNaming  →  acuñar name  →  docstatus = draft  →  owner de sesión
  →  BeforeValidate  →  validate(esquema)  →  Validate  →  BeforeInsert
  →  INSERT  →  AfterInsert  →  OnUpdate
```

Dos detalles del orden merecen explicación. **La autorización va primero**:
`Permission::Create` es un permiso a nivel de DocType, no necesita el body ni el
owner, y comprobarlo antes de cualquier hook evita que un llamante sin permiso
haga correr un `BeforeNaming` (los hooks tienen efectos) o distinga un 400 de un
403 según la forma del payload. **La comprobación de campos va después**:
`apply_field_permissions_write` elimina los campos que el llamante no puede
escribir y hashea los `Password` antes de que naming, hooks o el `INSERT` los vean.

`docstatus` no es un campo de payload: un documento nuevo entra siempre como
`draft`. Enviar `"submitted"` es un `400`; enviar `0` o `"draft"` se acepta como el
no-op que es (lo usa la copia de amend).

## Orden en update

```text
leer fila (owner y creation del stored)  →  rechazar system fields  →  permisos de campo
  →  merge  →  guard_update_after_submit  →  Write (permiso)
  →  BeforeValidate  →  validate  →  sello modified/modified_by
  →  Validate  →  BeforeSave
  →  [BeforeUpdateAfterSubmit]  →  UPDATE  →  versión
  →  AfterSave  →  OnUpdate  →  [OnUpdateAfterSubmit]  →  [OnChange]
```

Los corchetes son condicionales: `BeforeUpdateAfterSubmit` y
`OnUpdateAfterSubmit` solo corren si el documento **ya estaba** enviado y algún
campo no interno cambió de verdad; `OnChange` corre una sola vez si cambió algo,
porque hoy no existe metadata de `on_change` por campo. El estado "ya estaba
enviado" se lee del documento almacenado, nunca del mapa mezclado: un body no puede
elegir si participa del ciclo post-submit. `owner`, `creation` y `docstatus` se
rechazan si el body intenta moverlos: no se sobrescriben en silencio, porque un
`400` explícito evita que el llamante crea que transfirió la propiedad.

## Submit, cancel y amend

`set_docstatus` es una transacción única: lee la fila, comprueba la transición,
aplica el workflow, autoriza, ejecuta el hook `Before*`, escribe con el sello de
`modified`, registra la versión y ejecuta el hook `On*`.

```text
read  →  can_transition_to  →  enforce_workflow  →  Submit|Cancel|Amend (permiso)
  →  BeforeSubmit | BeforeCancel | BeforeSave
  →  persist + modified + versión
  →  OnSubmit | OnCancel | AfterSave
```

El **amend** no es una transición in-place: `DocStore::amend` lee el original con
`Permission::Amend`, borra `name` y los `SYSTEM_FIELDS`, calcula el siguiente
nombre `NAME-1`, `NAME-2`, … y hace un `create` normal. Vuelve a pasar por todo el
camino de insert (naming explícito, validación, hooks) y nace como draft.

## Delete

```text
read  →  rechazo si docstatus == 1  →  Delete (permiso)  →  BeforeDelete
  →  DELETE + cascada (share, version, comment, like)  →  tombstone de versión
  →  commit  →  OnTrash
```

Un documento enviado no se borra: hay que cancelarlo primero, con el mismo mensaje
que Frappe (*"Submitted Record cannot be deleted. You must Cancel it first."*).
`OnTrash` corre **después** del commit, con el documento en memoria; todo lo demás
ocurre dentro de la transacción y se deshace si algo falla.

## Rename

```text
read  →  Write (permiso)  →  comprobar que el destino no existe
  →  BeforeRename(old_name, new_name)  →  UPDATE name + data + modified
  →  mover tab_version y tab_share  →  AfterRename(old_name, new_name)
```

Todo en una transacción. `tab_version` y `tab_share` se mueven con la clave;
comentarios y likes **no** se mueven: es una limitación visible en lugar de
dejar una referencia colgando en silencio. Los dos nombres viajan en
`HookContext.metadata` (`old_name`, `new_name`), porque el documento solo puede
llevar uno: `run_hooks_with_metadata` es la forma que lo permite y `run_hooks`
sigue siendo la de siempre.

## Registro y prioridad

`HookRegistry` mantiene un `HashMap<String, Vec<HookEntry>>` por DocType.
`execute` corre las entradas locales; `execute_global` corre el registro procesal
(`HookRegistry::global()`), que es el que usan el motor, la API y los plugins. El
orden es **prioridad descendente** y, a igual prioridad, orden de inserción.
`register_tagged`/`replace_global` sustituyen la entrada del mismo
`(tag, doctype, point)` en vez de apilar otra copia: es lo que necesita el
dev-server al recargar un plugin. El guard del registro se libera **antes** de
esperar el future del hook, así que la ejecución es `Send` y no se retiene un lock
a través de un `.await`.

## `DocumentHook`

Los hooks no reciben el `struct` tipado, sino un trait:

```rust
pub trait DocumentHook: Send + Sync {
    fn doctype(&self) -> &str;
    fn name(&self) -> &str;
    fn get_field(&self, field: &str) -> Option<&Value>;
    fn set_field(&mut self, field: String, value: Value);
    fn get_fields(&self) -> &HashMap<String, Value>;
    fn is_new(&self) -> bool;
    fn docstatus(&self) -> DocStatus;
    fn set_docstatus(&mut self, status: DocStatus);
    fn owner(&self) -> &str;
    fn set_owner(&mut self, owner: String);
    fn modified_by(&self) -> &str;
    fn set_modified_by(&mut self, user: String);
}
```

El motor lo implementa con `MapDocument`, un mapa de campos. Un hook puede leer y
escribir el documento, y lo que escriba se persiste porque el motor reconstruye el
`Value` desde ese mapa al terminar.

## Cómo se reenvía a WASM

`ferris-wasm/src/store/hooks.rs` registra **un hook global por `(doctype, punto)`**
con el tag `ferris-plugin`, que traduce el punto a un evento kebab-case y llama a
`doctype-event` del guest:

| Operación | Eventos, en orden |
|---|---|
| insert | `before-naming`, `before-validate`, `validate`, `before-insert`, `created`, `on-update` |
| update | `before-validate`, `validate`, `before-save`, `before-update-after-submit`, `after-save`, `on-update`, `on-update-after-submit`, `on-change` |
| submit | `before-submit`, `submitted` |
| cancel | `before-cancel`, `cancelled` |
| trash | `before-delete`, `trashed` |
| rename | `before-rename`, `after-rename` |
| amend (a draft) | `before-save`, `after-save` |

Los puntos **pre-escritura** (`BeforeNaming`, `BeforeValidate`, `Validate`,
`BeforeInsert`, `BeforeSave`, `BeforeSubmit`, `BeforeCancel`,
`BeforeUpdateAfterSubmit`, `BeforeDelete`, `BeforeRename`) se
entregan de forma síncrona: si el guest devuelve un `error`, la escritura se
aborta y el error se traduce a su tipo de framework (422 validación, 403 permiso,
409 conflicto, …). El resto solo observa; un error suyo no revierte la fila ya
escrita y se convierte en `JobError::Failed`.

**Anti-reentrada.** `EngineContext::suppress_events` marca el contexto y el hook
del plugin se salta el envío. Lo activa `docstore::write-no-events` en el host
Rust y, desde el guest, la disposición explícita
`data::write-disposition.silent` de WIT 16; los demás hooks globales (etiquetas,
integraciones) siguen corriendo.
