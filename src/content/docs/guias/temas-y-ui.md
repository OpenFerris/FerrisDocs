---
title: Receta — temas y UI
description: Crear un tema completo (tokens en ambos modos, servidor y cliente), retocar componentes con CSS de plugin y verificar accesibilidad y contraste.
---

Un tema en Ferris no es una hoja de estilos: es un conjunto de **tokens**. Si el
tema declara los mismos nombres que el sistema, la aplicación entera se repinta
—componentes, chrome, carpetas, estado— sin tocar un solo `.rs`.

## 1. Decide el alcance

| Quieres | Haz esto |
|---|---|
| Otra paleta para toda la instalación | tema registrado en el servidor |
| Retocar un componente concreto | CSS de plugin sobre `.ferris-*` |
| Cambiar el aspecto de un dashboard | `DashboardStyle` / `StyleSpec` (no un tema) |
| Un color nuevo de verdad | token nuevo en los cuatro sitios |

Los tres primeros no se pisan: un tema mueve tokens, un plugin gana por capa y un
estilo de tablero es dato guardado.

## 2. Declarar el tema

Un tema es un id, una etiqueta, un flag `dark` y la lista de variables. Se registra
una vez, en el arranque del servidor (o al cargar la app):

```rust
use ferris_core::themes::{register_theme, ThemeSpec};

let tema = ThemeSpec {
    id: "oceano".into(),
    label: "Océano".into(),
    dark: true,
    vars: vec![
        ("--background".into(), "oklch(0.18 0.03 240)".into()),
        ("--foreground".into(), "oklch(0.97 0.01 240)".into()),
        ("--primary".into(), "oklch(0.72 0.13 220)".into()),
        ("--primary-foreground".into(), "oklch(0.18 0.03 240)".into()),
        ("--card".into(), "oklch(0.23 0.03 240)".into()),
        ("--card-foreground".into(), "oklch(0.97 0.01 240)".into()),
        ("--border".into(), "oklch(1 0 0 / 12%)".into()),
        ("--ring".into(), "oklch(0.72 0.13 220)".into()),
        // …
    ],
};

let registro = register_theme(tema);
for aviso in registro.warnings {
    eprintln!("tema descartado: {aviso}");
}
```

`register_theme` devuelve un `Registration` con los ids aceptados y los avisos: un
id vacío se descarta con un mensaje, no en silencio. Reemplaza un id existente en
lugar de duplicarlo.

Alternativa sin tocar Rust: declarar `"themes": [...]` en el `describe()` de una
app. El framework los registra al cargar el plugin.

`GET /api/themes` compone los incorporados (`light`, `dark`) con los registrados.
El Desk los lista en el `ThemeDialog`; el elegido se guarda en
`localStorage["ferris.theme"]`.

## 3. Cubre los dos modos

Un tema `dark: true` debe declarar **todos** los tokens que declara `:root`, no
solo los que parece que cambian. Motivos:

- el selector pinta una miniatura con la paleta del propio tema, y una variable
  ausente cae al fallback del sistema en vez del color que querías;
- `apply_theme` escribe solo las variables que recibe; el resto se queda con el
  valor del CSS;
- si el tema es uno de los incorporados, el test de paridad exige además que el
  conjunto coincida exactamente con `:root`.

La lista mínima es la del sistema: base (`--background`, `--foreground`, `--card`,
`--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--border`,
`--input`, `--ring`), estado (`--destructive`, `--success`, `--warning`, `--info`
con sus `-foreground`), superficie (`--surface`, `--overlay`) y chrome
(`--sidebar*`, `--topbar*`).

:::tip
Compara tu tema contra `:root` con un diff de nombres, no a ojo. Un token olvidado
no da error: da un color raro en un solo rincón de la interfaz.
:::

## 4. Reflejarlo en el cliente

Los incorporados viven en un único sitio de Rust
(`ferris_schema::contract::theme::builtin_themes`), y `ferris-web::theme` los usa
como **fallback** cuando `/api/themes` no responde (invitado, SSR, mantenimiento).
Si añades o cambias un token del sistema, actualiza:

1. `:root` y `.dark` de `ferris-web/style/tailwind.css`;
2. `builtin_themes()` para los dos incorporados;
3. `@theme inline` si el token necesita clase de Tailwind.

Los temas de app **no** se copian al cliente: llegan por `/api/themes`, y mientras
no lleguen el Desk usa los incorporados. Eso es correcto: un tema de app nunca es
la única forma de pintar la pantalla.

## 5. Retocar un componente con CSS de plugin

El CSS de un plugin se inyecta **sin capa**, así que gana sobre `@layer
components` y sobre `@layer utilities`. La forma segura es apuntar a las clases
estables del catálogo:

```css
/* assets/theme.css de la app */
.ferris-card {
  border-radius: var(--radius-lg);
  box-shadow: 0 1px 0 var(--border);
}

.ferris-button--accent {
  background: color-mix(in oklab, var(--primary) 85%, transparent);
}

.ferris-topbar {
  border-bottom: 1px solid var(--topbar-border);
  background: var(--topbar);
}

.ferris-desk-folder--blue {
  background: var(--folder-blue);
}
```

Reglas:

- usa `var(--token)`, nunca un literal de color;
- no dependas de clases de utilidad de Tailwind: no son contrato;
- no estilices por estructura (`div > span`) cuando existe una clase;
- no uses `!important` para ganar una guerra de especificidad: si hace falta, la
  clase del catálogo no está haciendo su trabajo.

## 6. Regenerar el CSS

Si tocaste clases o `tailwind.css`, `desk.css` hay que regenerarlo y commitearlo:

```bash
cd ferris-web
node_modules/.bin/tailwindcss -i style/tailwind.css -o style/desk.css --minify
```

Es el mismo comando de `[package.metadata.leptos] style-cmd`, y `ferris dev` lo
reejecuta al detectar cambios. Si solo añadiste un tema en Rust o un CSS de
plugin, `desk.css` no cambia.

Comprueba también que `tailwind.css` conserva
`@source "../../ferris-web-ui/src";`. Sin ella, las clases de la biblioteca se
purgan y los overlays quedan visibles.

## 7. Accesibilidad y contraste

Un tema bonito que no se lee es un fallo, no un estilo:

- **contraste** — texto normal ≥ 4.5:1 sobre su fondo; texto grande y bordes
  decorativos, ≥ 3:1. `foreground` sobre `background`, `card-foreground` sobre
  `card`, `*-foreground` sobre su color de estado;
- **no solo color** — un estado no puede comunicarse únicamente por tono. Acompaña
  con icono, texto o forma (`Badge` + texto, `Feedback` con `role`);
- **foco visible** — no elimines el anillo; si lo recoloreas, hazlo con `--ring`;
- **`color-scheme`** — `ThemeSpec::dark` decide si el navegador pinta scrollbars y
  selectores nativos en oscuro. Un tema oscuro con `dark: false` deja controles
  claros sobre fondo oscuro;
- **estados de hover/disabled** — un `hover` que baja el contraste por debajo del
  umbral es tan malo como un texto ilegible.

## Comprobación manual

1. Elige el tema en el selector: se aplica sin recargar y sobrevive a un refresh.
2. Abre `/login` sin sesión: se pinta con la paleta guardada, sin llamar a
   `/api/themes`.
3. Recorre formulario, lista, dashboard y un diálogo: no queda ningún elemento con
   el color del tema anterior.
4. Cambia de tema con un diálogo abierto y con un toast visible.
5. Fuerza el modo claro del sistema con un tema oscuro activo: scrollbars y
   selectores de fecha deben seguir oscuros.
6. Pasa un verificador de contraste sobre `muted-foreground` y los badges de
   estado.

:::danger
Nunca arregles un contraste con `!important` sobre una clase de utilidad. Si el
token no da el contraste, el problema es el token: cámbialo en el tema y en
`:root`.
:::

Ver [Theming](/frontend/theming/) para el sistema de tokens y
[Biblioteca de componentes](/frontend/componentes-ui/) para el catálogo de clases.
