---
title: Dashboards y widgets
description: La rejilla de 12 columnas, el layout efectivo por usuario o por documento, el builder de drag/resize y cómo se monta cada widget.
---

Un dashboard es una rejilla de 12 columnas de instancias de widget. La misma
rejilla sirve para lo que una app declara en `describe()`, para un documento
`Dashboard` y para un dashboard que *es* un documento.

## DashboardGrid

```rust
#[component]
pub fn DashboardGrid(
    owner: String,
    dashboard_id: String,
    label: String,
    seed: Vec<WidgetInstance>,
    #[prop(default = None)] document: Option<(String, String)>,
    #[prop(default = None)] declared_style: Option<DashboardStyle>,
) -> impl IntoView
```

- `seed` es lo que se pinta hasta que llega el layout efectivo (y también lo que
  queda si la carga falla). Se normaliza al entrar, una sola vez: una semilla
  declara referencias y casi ninguna celda, y sin normalizar todos los widgets
  caerían en `(0, 0)`, apilados en la esquina.
- `document` cambia el destino de lectura y escritura: en vez de
  `(owner, dashboard_id)`, el layout vive en los campos del propio documento.
- `declared_style` es el estilo que declara la app o el documento; el override
  guardado se superpone encima.

## Geometría

Las reglas viven en `ferris_schema::contract::layout`, compartidas con el servidor:
lo que el usuario ve es lo que la siguiente carga reproduce.

| Constante | Valor |
|---|---|
| `COLUMN` | 12 columnas |
| `CELL_HEIGHT_PX` | 72 px por fila |
| `MAX_ROWS` | 64 filas |
| `DEFAULT_ROWS` | alto por defecto de una instancia |

El tamaño de una referencia se resuelve contra el catálogo (`GridSize::resolve`):
`stat` → 3 columnas, `table` → 12, el resto 6, salvo que la definición declare
`size`/`min`. El builder nunca deja encoger por debajo de `min`.

`normalize` rellena huecos, recorta y recoloca solapes. `placement_of` traduce una
instancia a su caja. La caja se escribe como estilo inline con geometría —la
excepción a «nunca `style=`»—, porque "empieza en la columna 3 y mide 4×2" no es
una clase que Tailwind pueda purgar.

## Layout efectivo: por app, por usuario, por documento

```rust
pub enum LayoutTarget {
    App { owner: String, id: String },          // /api/dashboard-layout/{owner}/{id}
    Document { doctype: String, name: String }, // /api/dashboard-layout/doc/{doctype}/{name}
}
```

- En un dashboard de app, el servidor responde el **override guardado** o, si no
  existe, la semilla declarada. Se guarda con `PUT` de la lista completa y la
  respuesta —ya normalizada— es lo que se dibuja.
- En un dashboard de documento, no hay override por usuario: el layout son los
  campos `widgets`/`config` del documento y lo que guarda uno lo ve todo el mundo.

El conjunto de la rejilla se edita solo si el servidor dice `editable` (derecho
de edición de dashboard, o `Write` sobre el documento). Si no, la rejilla se
dibuja de solo lectura y no aparece ni la paleta ni el asa de arrastre.

## Estilo: tres niveles

El aspecto de un tablero se resuelve en un único sitio (`views/dashboard/style.rs`):

1. estilo global del Desk (una fila compartida, `/api/dashboard-settings`);
2. estilo declarado por el dashboard (app o documento `Dashboard`);
3. override guardado (`DashboardConfig`).

Los tres se aplican campo a campo: `board_style(global, declared, config)`. En una
tarjeta hay dos niveles, la definición y la instancia, y el Desk no añade un
tercero: la tarjeta es el **único** marco. Un widget que no declara nada se dibuja
como el elemento desnudo, sin padding ni superficie.

Los valores se emiten como **custom properties** (`--ferris-tile-*`), no como
clases: un token semántico se convierte en `var(--token)` y un color libre en su
propio valor, ambos validados antes de entrar en el atributo `style` (un
`background: "red; background-image: url(…)"` se descarta). Así un tema que
repinta `--card` repinta todas las tarjetas que pidieron `"card"`.

## Builder: arrastrar, redimensionar, configurar

- Un solo `DashboardTile` por instancia en un `<For key=id>`, en las dos caras:
  en lectura es la caja y el cuerpo; en edición añade el chrome (arrastrar,
  ajustes, quitar) y la esquina de redimensionado.
- El gesto se confirma en `pointerup`; mientras tanto solo mueve la *preview*.
  Mover o redimensionar no remonta el cuerpo del widget: la geometría es una señal
  derivada.
- `WidgetPalette` lista el catálogo agrupado por `category`. `WidgetProps` edita
  título, subtítulo, tamaño y parámetros. `BoardConfig` edita la geometría y la
  superficie del tablero, con un borrador en vivo: "Cancelar" cierra sin tocar lo
  guardado.
- Pantalla completa es un modo de la visita, no parte del estilo: no se persiste.

## Cómo se monta un widget

`WidgetHost` resuelve la referencia contra el catálogo del feed
(`owner.name`, o `name` contra el owner del tablero) y decide el cuerpo:

| Owner | Cuerpo |
|---|---|
| `host` | renderer nativo: `host.stat`, `host.trend`, `host.table` |
| cualquier otro | elemento personalizado de la app |
| sin resolver | marcador discontinuo con la referencia; el resto del tablero sigue |

El host pinta el **marco y el encabezado** (título y subtítulo según
`show_title`/`show_subtitle`); el cuerpo del widget es solo contenido. Los
widgets nativos leen datos por `DocStore` como la sesión actual, no por
`/plugins/*`.

Para un widget de app, el SSR emite un marcador
`/plugins/{owner}/widget/{reference}?params=…` mientras carga el módulo; después
el elemento real se monta desde un efecto con `data-params`, `data-label` y
`data-widget`. Por eso el cuerpo nunca aparece en el HTML del servidor: no puede
discrepar con el navegador.

## Parámetros

`params` es una lista de pares `(nombre, valor)`; el host solo transporta
cadenas y cada widget lo convierte según su `value-type`. `param_or` resuelve
"valor de la instancia, si no el `default` de la definición", y `number_param`
cae a un valor por defecto si el texto no es número.

Los parámetros de una definición se editan con el **mismo** sistema de campos que
un documento: `WidgetParam` se traduce a `FormField`, así que `depends_on`,
`read_only`, `hidden` y los grupos de sección funcionan igual en el panel de
propiedades que en un formulario.

:::caution
Un `host.*` sin el parámetro obligatorio (`doctype`) no intenta adivinar: pinta un
mensaje que dice qué falta. Un catálogo mal declarado debe verse, no fallar en
silencio.
:::

## Assets y SSR

- El JavaScript módulo se sirve desde `/api/widgets/{app}/{name}/script.js`, o en
  la ruta original `code_path` de la app para que los `import` relativos sigan
  resolviendo.
- El CSS de la fila del widget se aplica dentro del shadow root del elemento.
- `ssr` guarda marcado opcional junto a la definición; el Desk no lo usa para
  sustituir el montaje del cliente.

Siguiente: [Theming](/frontend/theming/) y las recetas de
[dashboards](/guias/dashboards/) y [widgets](/guias/widgets/).
