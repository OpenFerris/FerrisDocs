---
title: Workflows
description: Estados y transiciones con roles, condiciones y campos obligatorios, por encima del DocStatus.
---

Un workflow añade estados de negocio a un DocType submittable. Mientras que
`docstatus` tiene tres valores fijos, un workflow declara estados con nombre
(`Draft`, `Pending`, `Approved`, …) y las transiciones legales entre ellos. Es una
máquina de estados **de datos**: las condiciones se interpretan, no se evalúan como
código.

## La definición

```rust
pub struct Workflow {
    pub name: String,
    pub doctype: String,
    pub initial_state: String,
    pub states: Vec<WorkflowState>,
    pub transitions: Vec<WorkflowTransition>,
}

pub struct WorkflowState {
    pub state: String,
    pub label: Option<String>,
    pub style: StateStyle,          // Default | Primary | Info | Success | Warning | Danger | Inverse
    pub doc_status: DocStatus,      // 0, 1 o 2
    pub allow_edit: Vec<String>,
    pub allowed_actions: Vec<String>,
    pub auto_assign: Option<String>,
}

pub struct WorkflowTransition {
    pub name: Option<String>,
    pub action: String,             // "Submit", "Approve", "Reject", …
    pub from_state: String,
    pub to_state: String,
    pub allowed_roles: Vec<String>, // vacío = cualquier rol
    pub condition: Option<WorkflowCondition>,
    pub required_fields: Vec<String>,
    pub notify: bool,
}
```

Cada estado declara a qué `docstatus` corresponde. Eso conecta la máquina de
estados con el ciclo de vida: entrar en un estado que declara `submitted` es lo que
hace que el documento quede enviado. `WorkflowCondition` es una igualdad
(`field` + `equals: Value`).

## Declararlo con `#[workflow]`

```rust
use ferris_macro::workflow;

#[workflow(
    doctype = "Invoice",
    name = "Invoice Approval",
    states = [
        { name = "Draft", doc_status = "draft" },
        { name = "Pending", style = "warning", doc_status = "draft",
          allow_edit = ["Billing Manager"] },
        { name = "Approved", style = "success", doc_status = "submitted" },
        { name = "Rejected", style = "danger", doc_status = "cancelled" },
    ],
    transitions = [
        { action = "Submit", from_state = "Draft", to_state = "Pending" },
        { action = "Approve", from_state = "Pending", to_state = "Approved",
          allowed_roles = ["Billing Manager"], required_fields = ["approved_by"],
          notify = true },
        { action = "Reject", from_state = "Pending", to_state = "Rejected",
          allowed_roles = ["Billing Manager"] },
    ]
)]
pub struct InvoiceApproval;
```

El macro genera `InvoiceApproval::register_workflow()` y un helper libre
`register_invoice_approval_workflow()`; ambos llaman a
`global_workflow_engine().register(workflow)`.

- `doctype` es obligatorio.
- `name` por defecto es `"<doctype> Workflow"`.
- `initial_state` por defecto es el primer estado declarado.
- `doc_status` acepta `"submitted"`, `"cancelled"` y cualquier otra cosa como
  `draft`.
- `condition` usa la gramática segura `campo == número|"texto"|true`; no hay
  evaluación de código.

## Registro

`WorkflowEngine` guarda un workflow **por DocType** y la primera inscripción gana:

```rust
match workflows.entry(doctype) {
    Occupied(_) => Err(WorkflowError::AlreadyExists(doctype)),
    Vacant(slot) => { slot.insert(workflow); Ok(()) }
}
```

La comprobación y la inserción ocurren bajo el mismo write-guard, así que dos
registros concurrentes no pueden pasar ambos. Reemplazar un workflow no está
soportado: para cambiarlo hay que reiniciar el proceso.

`global_workflow_engine()` es un `LazyLock<WorkflowEngine>` procesal, accesible
desde cualquier crate: el motor de documentos lo consulta en `set_docstatus`.

## Enforcement

Un workflow no se aplica "solo en la UI". Cuando `set_docstatus` va a mover el
documento:

```text
1. can_transition_to(target)          // la arista de DocStatus
2. enforce_workflow(ctx, doc, current, target)
3. permiso Submit | Cancel | Amend
```

`enforce_workflow` hace lo siguiente. Si el DocType no tiene workflow registrado,
no hace nada: el DocStatus puro es toda la regla. Si lo tiene, calcula
el estado de origen (el campo `workflow_state` del documento si existe y no está
vacío; si no, `initial_state`), mapea el destino a una acción
(`Submitted → "Submit"`, `Cancelled → "Cancel"`, `Draft → "Amend"`), llama a
`workflow.apply(from_state, action, roles_del_usuario, contexto)` y comprueba que
el estado de destino declara exactamente el `doc_status` pedido. Si el workflow dice
que esa transición aterriza en draft, no se puede usar para enviar el documento.

El contexto de la condición es el documento completo, así que `amount == 0`
compara con el valor almacenado.

:::caution[El estado de origen es el campo `workflow_state`]
`set_docstatus` **no escribe** `workflow_state`. Si tu workflow no actualiza ese
campo (por ejemplo con un hook `OnSubmit`), la siguiente transición partirá de
`initial_state` otra vez. Es el punto donde un workflow "se queda atascado" sin que
el motor proteste.
:::

## `apply`

```rust
pub fn apply(
    &self, from_state: &str, action: &str, roles: &[String],
    context: &HashMap<String, Value>,
) -> Result<TransitionOutcome>
```

Recorre las transiciones y se queda con la primera que cumpla estado, acción y rol
(`allowed_roles` vacío = cualquier rol). Después:

- si la condición no se cumple, marca `blocked_by_condition` y sigue buscando;
- con una candidata válida, comprueba `required_fields`: cada uno debe existir y no
  ser nulo, o `WorkflowError::RequiredField`;
- resuelve el estado destino; si no existe, `WorkflowError::NotFound`;
- devuelve `TransitionOutcome { state, doc_status }`.

Si había candidatas pero todas quedaron bloqueadas, el error es `ConditionNotMet`;
si no había ninguna, `InvalidTransition`.

## Eventos

`WorkflowEngine::transition` (distinto de `apply`) aplica la transición y emite un
`WorkflowEvent` a los listeners de `on_transition`: `workflow`, `doctype`,
`action`, `from_state`, `to_state`, `notify`, `timestamp`. Los listeners son
síncronos.

`set_docstatus` usa `apply`, no `transition`: la transición de un documento **no**
emite el evento por sí sola. Si necesitas notificar, hazlo en un hook
`OnSubmit`/`OnCancel` o llama a `transition` desde tu punto de entrada.

## Qué no hace

| Campo | Estado real |
|---|---|
| `allowed_actions` | Informativo: lo que manda son las transiciones. |
| `allow_edit` | Declarado y transportado; el motor no lo aplica. |
| `auto_assign` | Declarado y transportado; el motor no asigna nada. |
| `notify` | Solo viaja en el evento; no envía nada por sí mismo. |

Están en la definición para que el Desk y un listener puedan usarlos, no porque el
motor los imponga. Un workflow con `allow_edit` no bloquea la edición por sí solo;
para eso está el bloqueo post-submit de
[DocStatus](/conceptos/docstatus/#bloqueo-post-submit).

## Errores

| Error | Cuándo |
|---|---|
| `NotFound(doctype)` | No hay workflow registrado para ese DocType. |
| `NotFound(state)` | El estado destino no existe en `states`. |
| `AlreadyExists(doctype)` | Segundo registro del mismo DocType. |
| `InvalidTransition` | Nada casa con estado + acción + rol, o el `doc_status` no coincide. |
| `ConditionNotMet` | Había candidata pero la condición la bloqueó. |
| `RequiredField(field)` | Falta un campo obligatorio de la transición. |

## Cuándo usarlo

Aprobaciones con roles distintos (quien crea no es quien aprueba), documentos con
varios estados antes de enviarse, o cualquier flujo donde `draft → submitted` sea
demasiado grueso. Si el flujo es lineal y sin roles, `docstatus` basta; si necesitas
lógica arbitraria, un workflow solo entiende igualdades y campos obligatorios, así
que esa lógica va en un hook `Validate`, no en una condición disfrazada.
