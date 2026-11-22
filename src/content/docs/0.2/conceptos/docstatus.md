---
title: DocStatus
description: Los tres estados de un documento, sus transiciones legales y cómo
  se guardan en la base de datos y en el JSON.
slug: 0.2/conceptos/docstatus
---

`docstatus` expresa en qué punto del ciclo de vida está un documento. Es la
representación de Ferris del mismo concepto de Frappe, con los mismos valores
numéricos.

## Los tres estados

```rust
pub enum DocStatus {
    Draft = 0,
    Submitted = 1,
    Cancelled = 2,
}
```

`ferris_core::hooks::DocStatus` se serializa en minúsculas (`"draft"`,
`"submitted"`, `"cancelled"`) y expone `as_i64()` / `from_i64()`.

`from_i64` devuelve `Option<Self>`: un valor distinto de 0, 1 o 2 es `None`, no se
mapea al estado más parecido. Un `docstatus` corrupto debe notarse.

## Transiciones válidas

`can_transition_to` define exactamente tres aristas:

```text
Draft ──submit──▶ Submitted ──cancel──▶ Cancelled
  ▲                                        │
  └──────────────amend─────────────────────┘
```

En código:

```rust
matches!(
    (self, target),
    (Draft, Submitted) | (Submitted, Cancelled) | (Cancelled, Draft)
)
```

No hay `Draft → Cancelled`, ni `Submitted → Draft` directo, ni
`Cancelled → Submitted`. Cualquier otra combinación es
`ValidationError::Invalid("invalid transition …")`.

## Qué significa "enviado"

Un DocType solo tiene ciclo de vida si declara `is_submittable`. En uno que no lo
declare, `docstatus` existe igualmente en la tabla y en el blob, pero las
transiciones no forman parte del modelo de negocio y los permisos
`Submit`/`Cancel` no se conceden (la traducción de `DocPerm` los elimina cuando el
DocType no es submittable). El motor no comprueba el flag por sí mismo: quien lo
hace cumplir es la concesión de permisos, y `System Manager` se la salta.

Un documento enviado es la verdad registrada de una transacción: no se puede
borrar, y solo se puede editar en los campos marcados `allow_on_submit`. Uno
cancelado está bloqueado por completo.

## Submit y cancel

`DocumentEngine::set_docstatus` es una transacción única:

```text
read row
  → can_transition_to(target)
  → enforce_workflow (si el DocType tiene workflow registrado)
  → permiso Submit | Cancel | Amend
  → hook BeforeSubmit | BeforeCancel | BeforeSave
  → persist (data + docstatus + modified + modified_by)
  → record_version(Submit | Cancel | Update)
  → hook OnSubmit | OnCancel | AfterSave
```

Detalles que importan:

* El permiso se comprueba **después** de la transición y del workflow, así que un
  workflow que no permite la acción gana sobre un rol que sí la permitiría.
* El `modified` se sella igual que en cualquier otro save, así que una transición
  no deja la marca obsoleta.
* La lectura y la escritura ocurren en la **misma** transacción, así que una
  escritura concurrente no se pierde entre ambas.
* La versión se registra dentro de la misma transacción, con el mismo `WriteSink`.

## Amend

Amend no es una transición in-place: es una **copia** que nace como draft.

```text
get_for(source, Permission::Amend)
  → copiar el documento
  → borrar name y SYSTEM_FIELDS (owner, creation, modified, modified_by)
  → docstatus = 0
  → name = NAME-1 (o el siguiente libre)
  → amended_from = NAME, si el DocType declara ese campo
  → create(...)   // vuelve a pasar por naming, validación y hooks
```

Consecuencias:

* El dueño de la copia es quien hace el amend, no el dueño original.
* La cadena queda legible: `INV-0001 → INV-0001-1 → INV-0001-1-1`.
* Un número de amend borrado **no** se reutiliza.
* Hace falta `Permission::Amend` sobre el documento origen, no solo `Read`.

## Bloqueo post-submit

`guard_update_after_submit` se ejecuta en cada update, antes de autorizar:

```text
cancelled  → cualquier campo no interno modificado = 400
submitted  → solo campos con allow_on_submit = true pueden cambiar
draft      → sin restricciones
```

Los campos que el motor sella (`owner`, `creation`, `modified`, `modified_by`,
`name`, `docstatus`) nunca cuentan como "cambio del usuario", así que un save que
solo actualiza `modified` no dispara el bloqueo.

Si no hay metadata disponible, no se puede demostrar que un campo sea
`allow_on_submit`, y el resultado conservador es **rechazar** todo cambio en un
documento post-submit.

## `docstatus` no es un campo del payload

En un insert, el body solo puede traer `docstatus` si vale `0` o `"draft"`. Cualquier
otro valor es:

```text
400 `docstatus` transitions are a workflow action, not a payload field (got …)
```

La razón es de seguridad: aceptar `"submitted"` en el body crearía una fila ya
enviada sin pasar por ninguna comprobación de permiso ni por `can_transition_to`.

En un update, el `docstatus` del body se compara con el almacenado y se rechaza si
difiere. Enviar el mismo valor es el no-op que es.

## Representación en disco y en JSON

Hay dos representaciones y las escribe el mismo valor:

| Sitio | Forma |
|---|---|
| Columna `docstatus` | `SMALLINT` (`0`, `1`, `2`), `NOT NULL DEFAULT 0` |
| Blob `data` | Palabra: `"draft"`, `"submitted"`, `"cancelled"` |

```sql
-- columna
SELECT name, docstatus FROM tabInvoice WHERE docstatus = 1;

-- blob
SELECT data FROM tabInvoice WHERE name = 'INV-0001';
-- { "docstatus": "submitted", ... }
```

Filtrar por la columna es lo correcto para listas y recuentos: tiene índice
(`idx_docstatus`). El blob es la forma que viaja por la API.

## Permisos por acción

Las tres acciones del ciclo tienen permiso propio en `DocPerm`, y ninguna se
implica de otra:

| Acción | Permiso | Nota |
|---|---|---|
| Enviar | `submit` | Solo si el DocType es submittable. |
| Cancelar | `cancel` | Solo si el DocType es submittable. |
| Enmendar | `amend` | Se comprueba sobre el documento **origen**. |

`Permission::Manage` en una regla `DocPerm` significa `read && write && delete`
(en la fila), no "todos los derechos". En una política instalada, en cambio,
`Manage` se expande a todas las acciones. La diferencia está fijada por test,
porque confundirlas convertiría una regla de tres derechos en una de trece.

El atajo de owner concede `Read`, `Write` y `Amend` sobre el propio documento,
pero **nunca** `Submit`, `Cancel`, `Delete`, `Import` ni `Export`.

## Errores típicos

| Situación | Error |
|---|---|
| `Draft → Cancelled` | `ValidationError::Invalid("invalid transition …")` |
| Borrar un enviado | `"Submitted Record cannot be deleted. You must Cancel it first."` |
| Editar un campo bloqueado | `"`x` cannot be changed on a submitted document (allow_on_submit = false)"` |
| Editar un cancelado | `"`x` cannot be changed on a cancelled document"` |
| Enviar sin permiso o fuera del workflow | `AuthzError::PermissionDenied`, `WorkflowError::InvalidTransition` o `ConditionNotMet` |

## Interacción con workflows

Si el DocType tiene un workflow registrado, `set_docstatus` no basta: el workflow
decide si la acción es legal para los roles del llamante y el estado resultante
debe declarar exactamente el `doc_status` pedido. Si el workflow dice que la
transición aterriza en draft, no se puede usar para llegar a submitted. Detalle en
[Workflows](/0.2/conceptos/workflows/).
