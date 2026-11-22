---
title: Theming
description: Los tokens semánticos de :root y .dark, el mapeo a Tailwind, el selector de temas y el pipeline de desk.css.
---

Todo el color del Desk sale de **tokens semánticos**. Un componente nunca decide
un valor: referencia un token y el tema activo hace el resto. Eso permite dos
cosas a la vez: que un tema repinte la aplicación entera y que un plugin retoque
un componente concreto sin pelear con utilidades.

## Los tres sitios que deben coincidir

`ferris-web/style/tailwind.css` declara cada token en tres lugares:

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.153 0.006 107.1);
  --primary: oklch(0.228 0.013 107.4);
  /* … */
}

.dark {
  --background: oklch(0.153 0.006 107.1);
  --foreground: oklch(0.988 0.003 106.5);
  --primary: oklch(0.93 0.007 106.5);
  /* el mismo conjunto, valores oscuros */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  /* … */
}
```

- `:root` y `.dark` deben tener **el mismo conjunto de nombres**. Un token que
  falta en `.dark` cae al valor claro y rompe el modo oscuro.
- `@theme inline` es lo que convierte `--background` en la clase `bg-background`.
  Un token sin mapear no tiene clase.

## Familias de tokens

| Familia | Tokens |
|---|---|
| Base | `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--border`, `--input`, `--ring` |
| Estado | `--destructive`, `--success`, `--warning`, `--info` (+ cada `-foreground`) |
| Superficie | `--surface`, `--surface-foreground`, `--overlay` |
| Chrome | `--sidebar*`, `--topbar*` |
| Carpetas del Desk | `--folder-slate`, `--folder-blue`, `--folder-emerald`, `--folder-amber`, `--folder-rose`, `--folder-violet` |

Los tokens **estructurales** viven solo en `:root` y quedan fuera del test de
paridad, igual que `--radius`: `--sidebar-width`, `--sidebar-width-icon`,
`--bottom__nav__height`. Son medidas, no colores.

`--radius` genera la escala (`--radius-sm` … `--radius-xl`) en `@theme inline`, así
que `rounded-md` y `rounded-lg` siguen al tema.

## El tema activo

Los temas son datos: un id, una etiqueta, un flag `dark` y una lista de variables.
El tipo canónico es `ferris_schema::contract::theme::ThemeSpec`, con dos temas
incorporados:

```rust
pub struct ThemeSpec {
    pub id: String,
    pub label: String,
    pub dark: bool,
    pub vars: Vec<(String, String)>,
}
```

`ferris-web/src/theme.rs` reexporta `builtin_themes()` como fallback del cliente:
si `/api/themes` no responde (invitado, SSR, mantenimiento) el Desk tiene igual su
paleta. El servidor compone los incorporados con los que registre una app
(`ferris_core::themes` + `GET /api/themes`).

`ThemeCtx` guarda la lista y el id activo:

```rust
pub struct ThemeCtx {
    pub themes: RwSignal<Vec<ThemeSpec>>,
    pub current: RwSignal<String>,
}
```

Ciclo de vida:

1. `init_local()` — restaura el id guardado y pinta con la paleta conocida; se usa
   en `/login` como invitado, donde `/api/themes` daría 401.
2. `init()` — `init_local()` y después `refresh()`.
3. `refresh()` — pide `/api/themes`, y si el id guardado ya no existe cae al tema
   por defecto.
4. `select(id)` — actualiza el estado, persiste y repinta.

Persistencia: `localStorage["ferris.theme"]`. El catálogo se cachea para toda la
vida del proceso —en el navegador, del documento— porque no cambia dentro de una
visita.

`apply_theme` (solo wasm) hace tres cosas sobre `<html>`: pone `data-theme`, fija
`color-scheme` según `spec.dark` y escribe las variables en un único
`<style id="ferris-theme">` como `:root{--k:v;…}`.

:::note
`color-scheme` no es cosmético: scrollbars, selectores de fecha y `<select>`
nativos lo siguen. Sin él, un tema oscuro deja barras y calendarios con el
esquema claro.
:::

`ThemeDialog` es el selector: una ventana en miniatura pintada con la paleta del
propio tema, para elegir por colores y no por nombre. Lo abren tanto el menú de
módulos de la sidebar como el menú de usuario de `/desk`.

## Paridad: el test que no perdona

`ferris-web/tests/design_system.rs` lee `tailwind.css` y `components.css` en
tiempo de test y compara:

| Test | Qué garantiza |
|---|---|
| `dark_block_mirrors_root_token_set` | `.dark` declara los mismos nombres que `:root` |
| `tailwind_tokens_match_client_fallback_themes` | los tokens de `:root` y el fallback del cliente son el mismo conjunto |
| `tailwind_values_match_client_fallback_themes` | los **valores** coinciden, no solo los nombres |
| `theme_inline_colors_reference_declared_tokens` | cada `--color-*` apunta a un token declarado |
| `catalog_classes_exist_in_components_css` | cada constante de `ferris_web_ui::catalog` tiene su regla |
| `no_raw_colour_literals_outside_allowlist` | no hay colores literales en el Rust |

Si añades un token y olvidas un sitio, el test falla. Ese es el objetivo.

## Añadir un token nuevo

1. Decláralo en `:root` **y** en `.dark` de `style/tailwind.css`.
2. Mapealo en `@theme inline` (`--color-marca: var(--marca);`).
3. Refleja el valor en el fallback del cliente
   (`ferris_schema::contract::theme::builtin_themes`) para que los temas de
   servidor y el cliente no discrepen.
4. Regenera `desk.css` y úsalo como `bg-marca` / `text-marca-foreground`.

## Pipeline de CSS

```bash
cd ferris-web
node_modules/.bin/tailwindcss -i style/tailwind.css -o style/desk.css --minify
```

Es el mismo comando que declara `[package.metadata.leptos] style-cmd` y el que
`ferris dev` ejecuta al detectar cambios. `desk.css` se commitea junto al cambio
de clases y se sirve en `/static/desk.css`.

En `tailwind.css` deben quedarse las dos directivas `@source`: la de `../src` y la
de `../../ferris-web-ui/src`. Sin la segunda, todas las clases de la biblioteca se
purgan y los overlays que se ocultan con
`.data-[state=closed]:opacity-0` se quedan visibles para siempre.

## Colores prohibidos

:::danger
Nunca escribas `#hex`, `rgb()`, `rgba()`, `hsl()`, `oklch()` a mano en un
componente, ni `style=` para color, ni clases de paleta con tono
(`bg-zinc-200`, `text-gray-500`, `text-white`, `bg-blue-600`). Tampoco `dark:`
para color: los temas de runtime pintan `:root` y `.dark` no se aplica, así que
esas variantes son código muerto.
:::

Los únicos `style=` legítimos son datos en runtime: la geometría de una tarjeta de
dashboard y la miniatura del selector de temas, ambos validados.

Siguiente: [SSR e hidratación](/frontend/ssr-hidratacion/) y la
[receta de temas](/guias/temas-y-ui/).
