---
title: Biblioteca de componentes
description: El catálogo de ferris-web-ui agrupado por familia, cómo se componen los botones y las reglas que mantienen los colores en el sistema de diseño.
---

`ferris-web-ui/src/components/ui/` es la capa visual hoja del Desk: ~90
componentes, sus hooks y las clases `.ferris-*` del catálogo. No conoce rutas,
datos ni el motor, así que editar un componente no obliga a recompilar lo de
arriba.

## El catálogo por familia

| Familia | Componentes |
|---|---|
| Estructura y superficie | `card`, `bento_grid`, `aspect_ratio`, `separator`, `scroll_area`, `header`, `footer`, `item`, `marker`, `empty` |
| Overlays | `dialog`, `alert_dialog`, `sheet`, `drawer`, `popover`, `hover_card`, `tooltip`, `dropdown_menu`, `context_menu`, `menubar`, `command` |
| Entradas de formulario | `input`, `textarea`, `input_group`, `input_otp`, `input_phone`, `input_prompt`, `select`, `select_native`, `multi_select`, `checkbox`, `radio_button`, `radio_button_group`, `switch`, `slider`, `label`, `field`, `form`, `auto_form`, `date_picker`, `attachment`, `toggle_group` |
| Datos | `table`, `data_table`, `data_grid`, `charts`, `progress`, `avatar`, `badge`, `status`, `chips`, `pagination` |
| Feedback | `alert`, `callout`, `spinner`, `skeleton`, `shimmer`, `toast_custom`, `message` |
| Navegación | `breadcrumb`, `tabs`, `stepper`, `sidenav`, `navigation_menu`, `bottom_nav`, `accordion`, `collapsible`, `link`, `button_group`, `button_action`, `action_bar`, `kbd` |

Los hooks viven en `components/hooks/`: `use_form`, `use_virtual_scroll`,
`use_pagination`, `use_data_grid_state`, `use_click_outside`, `use_media_query`,
`use_theme_mode`, `use_cell_edit`, `use_column_state`, entre otros. Si una vista
necesita comportamiento, la respuesta es un hook, no un `view!` con estado
suelto.

## Botones: `variants!` con clases literales

`Button` se declara con la macro `variants!` de `leptos_ui`. Las clases base, las
de variante y las de tamaño son **literales de cadena**; los colores se resuelven
en `style/components.css`, no aquí.

```rust
variants! {
    Button {
        base: "ferris-button inline-flex items-center justify-center gap-2 …",
        variants: {
            variant: {
                Default: "ferris-button--default shadow-xs",
                Destructive: "ferris-button--destructive shadow-xs",
                Outline: "ferris-button--outline border shadow-xs",
                Ghost: "ferris-button--ghost",
                Accent: "ferris-button--accent",
                Link: "ferris-button--link underline-offset-4 hover:underline",
            },
            size: {
                Default: "h-9 px-4 py-2 has-[>svg]:px-3 max-md:h-10",
                Sm: "h-8 rounded-md gap-1.5 px-3 max-md:h-10",
                Icon: "size-9 max-md:size-10",
            }
        },
        component: { element: button, support_href: true, support_aria_current: true }
    }
}
```

Uso en una vista:

```rust
use crate::components::ui::button::{Button, ButtonSize, ButtonVariant};

view! {
    <Button
        variant=ButtonVariant::Outline
        size=ButtonSize::Sm
        attr:aria-label="Recargar"
        on:click=move |_| recargar()
    >
        { "Recargar" }
    </Button>
}
```

Reglas:

- Una variante nueva se **añade a `button.rs`**, no se improvisa en la vista.
- Nunca `format!` de nombres de clase ni clases construidas en runtime.
- La `class` del llamante se fusiona con `tw_merge!`, y solo debe usarse para
  layout o tamaño, nunca para recolorear una variante.

## `tw_merge!`, `clx!` y el merge de clases

- `tw_merge!("…", class)` resuelve colisiones de utilidades Tailwind conservando
  la última. Es el patrón de todo componente que acepta `class`.
- `clx!` (de `leptos_ui`) declara un componente estructural a partir de una
  etiqueta y una clase base, sin escribir el `view!` a mano:
  `clx! { ChatHeader, header, "flex items-center border-b" }`.
- `clw!` no se usa en este repositorio: la forma canónica aquí es `clx!`.

## Catálogo `.ferris-*` y `components.css`

Cada componente visual emite una clase estable, declarada como constante en
`ferris-web-ui/src/catalog/` y definida como regla en
`ferris-web/style/components.css`:

```text
.ferris-<componente>                    raíz
.ferris-<componente>--<variante|size>   variante o tamaño
.ferris-<componente>__<parte>           parte estructural
```

Rust conserva solo las utilidades estructurales (layout, espaciado, tipografía y
los efectos que no son color); los colores viven en `components.css`
con `var(--token)`. Eso da dos niveles de theming: un tema cambia el token y todo
sigue; un plugin apunta a `.ferris-*` con su propio CSS (sin capa, así que gana) y
retoca un componente concreto.

El test `ferris-web/tests/design_system.rs` comprueba que cada constante del
catálogo existe como selector en `components.css`, y que no aparecen colores
literales fuera de la lista permitida. Si declaras una clase y no escribes su
regla —o al revés— el test falla.

:::tip
Añadir un componente nuevo significa tres cosas: el módulo en `components/ui/`,
su entrada en `ui/mod.rs` y, si tiene color propio, la constante en `catalog/`
más la regla en `components.css`.
:::

## Accesibilidad y ganchos de test

- Todo control interactivo es un `<button>` o un `<a>` real, con `type`,
  `disabled`, `aria-*` y anillo de foco visible. Nada de `on:click` en un `<div>`.
- Los overlays atrapan el foco y se cierran con Escape; `dialog`, `sheet`,
  `drawer` y `command` comparten el scrim `.ferris-overlay`.
- Los componentes conservan su `data-name="__Componente"`; es el selector de los
  tests de extremo a extremo. No lo renombres por gusto.
- Una etiqueta `aria-label` vacía es peor que ninguna: si el botón es solo icono,
  el nombre accesible es obligatorio.

## Colores: solo tokens semánticos

Permitido: `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`,
`bg-primary`, `text-primary-foreground`, `border-border`, `ring-ring`,
`bg-success`, `text-warning-foreground`, `bg-sidebar`…

Prohibido en todas partes: `#hex`, `rgb()`, `hsl()`, `oklch()` escritos a mano en
Rust, `style=` para color y clases de paleta con tono (`bg-zinc-200`,
`text-gray-500`, `bg-blue-600`). Los detalles y el pipeline están en
[Theming](/frontend/theming/).

:::danger
Un color nuevo no se inventa en un componente: se añade al token set en `:root`
**y** `.dark`, se mapea en `@theme inline` y se refleja en el fallback del
cliente. El test de paridad no perdona olvidar un paso.
:::

Siguiente: [Formularios](/frontend/formularios/).
