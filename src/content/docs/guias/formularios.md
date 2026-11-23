---
title: Receta — formularios
description: Añadir un campo, un control propio, una validación, una acción de cabecera y un formulario completamente custom.
---

Esta receta asume un DocType existente. Si todavía no tienes uno, empieza por
[Tu primer DocType](/getting-started/primer-doctype/).

## 1. Añadir un campo

Un campo nuevo es **metadata**, no código. Si el DocType se declara en Rust:

```rust
use ferris_schema::{DoctypeMeta, FieldMeta};

pub fn task_meta() -> DoctypeMeta {
    DoctypeMeta::new("Task", "Projects")
        .field(FieldMeta::data("title").label("Título").required().in_list_view())
        .field(
            FieldMeta::select("prioridad", "Baja\nMedia\nAlta")
                .label("Prioridad")
                .default_value("Media")
                .in_list_view(),
        )
}
```

Reglas que el formulario respeta sin tocar la vista:

- `required` → `reqd`, y el asterisco lo pinta el renderer.
- `read_only` → el control se dibuja bloqueado.
- `default_value` → valor inicial, también en modo `new`.
- `depends_on` → visibilidad condicional.
- `in_list_view` → aparece en la lista.
- `description` → texto de ayuda bajo el control.

:::tip
`ferris migrate` aplica la metadata al esquema. No escribas SQL a mano para
añadir una columna.
:::

Para un cambio sin tocar código, el Desk tiene el editor de personalización
(`POST /api/customization/{doctype}/fields` y `/properties`). Esa personalización
se exporta a `<mundo>/customizations/` (en un bench,
`apps/<app>/customizations/`) y `ferris migrate` la reaplica en una base nueva.

## 2. Un control de campo propio

Cada `fieldtype` tiene su rama en `render_form_field`
(`components/views/form/field_renderer.rs`). El patrón es: rama explícita que
nombra un componente real de `field_types`, más el chrome compartido (label,
error, descripción).

```rust
// components/views/form/field_renderer.rs
"Rating" => view! {
    <RatingField id=id.clone() value=f.value read_only=read_only />
}.into_any(),
```

Añadir un tipo nuevo son tres pasos:

1. el componente en `components/views/form/field_types.rs`;
2. la rama en `render_form_field` (no un `_` genérico: cada tipo se nombra);
3. su caso en `validate_form` si necesita una regla propia.

El `_` final existe solo para un fieldtype que el Desk no conoce (uno más nuevo
declarado por un plugin): cae a un input de texto en lugar de romper. Nunca debe
alcanzarse en el caso normal.

## 3. Una validación

Dos niveles, y conviene saber cuál estás tocando.

**En la metadata** (sin código): `required`, `min_value`/`max_value`,
`max_length`, `precision` y `depends_on`. `validate_form` ya los aplica.

**En el cliente** (regla de forma, no de datos): añade el caso a `validate_form`.
Recibe `&[FormField]`, escribe en `f.error` y devuelve `bool`.

```rust
// views/services/form_service/layout.rs, dentro del bucle de validate_form
if f.fieldname == "fecha_fin" {
    let inicio = fields
        .iter()
        .find(|c| c.fieldname == "fecha_inicio")
        .map(|c| c.value.get_untracked())
        .unwrap_or_default();
    let fin = f.value.get_untracked();
    // Las fechas ISO ordenan igual que el tiempo, así que comparar como texto vale.
    if !fin.is_empty() && !inicio.is_empty() && fin < inicio {
        f.error.set(Some("La fecha de fin no puede ser anterior al inicio".into()));
        ok = false;
    }
}
```

Dos advertencias sobre esa regla: la validación de UI **no** es la de negocio (el
motor vuelve a validar en el servidor, así que una regla que solo vive aquí se
salta con un `POST` directo), y un campo invisible no puede bloquear el guardado
(`validate_form` salta los que `condition::is_visible` rechaza, y una expresión
malformada **muestra** el campo).

## 4. Un botón o una acción

Los botones de la cabecera del formulario no se ponen en la vista: se publican en
la top bar compartida.

```rust
use crate::components::desk::top_bar::{
    ButtonSpec, TopBarAction, use_top_bar_actions,
};
use crate::components::ui::button::ButtonVariant;

let actions = use_top_bar_actions();
actions.set(vec![TopBarAction::Button(ButtonSpec {
    label: "Cerrar tarea".into(),
    aria_label: None,
    icon: Some("Check"),
    variant: ButtonVariant::Outline,
    disabled: false,
    on_click: Callback::new(move |_| cerrar_tarea()),
})]);
```

El `Callback` se crea en el **cuerpo del componente**, no dentro del efecto que
publica la lista: los valores creados en un efecto pertenecen a su arena y se
disponen en la siguiente ejecución, dejando el botón apuntando a algo muerto.

Para una acción que forma parte de la app en lugar del ciclo de vida del
documento, declárala en un `Action` del DocType (aparece como botón de documento)
o en un slot `form.toolbar.right`.

## 5. Un formulario completo, custom

Si el formulario de metadata no llega, una app puede sustituirlo declarando el
slot `form.view` para **ese** DocType. El elemento recibe el documento ya cargado:

```html
<app-task-editor
  data-owner="projects"
  data-component="task-editor"
  data-doctype="Task"
  data-name="TASK-0001"
  data-module="Projects"
  data-docstatus="0"
  data-doc='{"name":"TASK-0001","title":"Revisar","prioridad":"Alta"}'
  data-props='{"modo":"compacto"}'>
</app-task-editor>
```

Dentro, reutiliza los componentes del catálogo en lugar de inventar inputs:
`Button` con `variants!`, `Card`, `Field`, `Input`, `Select`, `Dialog`, `Badge`,
`Feedback` para los estados.

:::caution
`form.view` sin `doctype` nunca coincide: es la protección para que un plugin no
reemplace todos los formularios por accidente. Y si la app falla al montar, el
Desk no vuelve al formulario de metadata —por eso el slot es un reemplazo
explícito, no un parche.
:::

## Ejemplo completo

Un DocType `Task` con prioridad editable y una acción propia en la cabecera:

```rust
// 1. metadata: prioridad (ver arriba) — 2. lista: .in_list_view() en prioridad
// 3. cabecera del formulario
let actions = use_top_bar_actions();
let cerrado = Signal::derive(move || docstatus.get() == 2);
Effect::new(move |_| {
    actions.set(vec![
        TopBarAction::Button(ButtonSpec {
            label: "Reabrir".into(),
            aria_label: None,
            icon: Some("RotateCcw"),
            variant: ButtonVariant::Outline,
            disabled: !cerrado.get(),
            on_click: reabrir,
        }),
    ]);
});
```

Guarda el cambio con `Ctrl+S` o el botón del ciclo de vida: `save_action` valida,
construye el payload y deja el resultado en `last_write`, que la barra convierte
en un toast.

## Comprobación manual

1. `/desk/{module}/Task/new`: el campo aparece, con su valor por defecto.
2. Deja un obligatorio vacío y guarda: el error se marca junto al control y no
   sale ninguna petición.
3. Pon el campo en una condición falsa: desaparece y ya no bloquea el guardado.
4. Guarda, envía y cancela: cada transición deja su propio mensaje.

Ver [Formularios](/frontend/formularios/) para el modelo interno y
[Listas y vistas](/guias/listas-y-vistas/) para el índice del DocType.
