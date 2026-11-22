---
title: Receta — dashboards
description: Declarar un dashboard como documento o desde una app, sembrar sus
  widgets, darle estilo, editarlo y comprobarlo.
slug: 0.2/guias/dashboards
---

Un dashboard es una ruta y una lista ordenada de instancias de widget. Se puede
declarar de dos formas y el Desk las trata igual: documento `Dashboard` o
`describe().dashboards` de una app.

## Opción A: documento `Dashboard`

La vía sin recompilar. El `name` del documento **es** el id del dashboard.

| Campo | Para qué |
|---|---|
| `label` | título de la cabecera (si falta, se usa el id) |
| `route` | URL del Desk, p. ej. `/proyectos` |
| `is_default` | mostrarlo en `/` (el primero gana) |
| `style` | objeto `DashboardStyle` (`background`, `gap_px`, `padding_px`, `border_radius`, `title_full_screen`) |
| `widgets` | tabla hija `Dashboard Widget` con las colocaciones |

Cada fila de `Dashboard Widget` es un `WidgetInstance`:

| Campo | Significado |
|---|---|
| `widget_id` | id único dentro del dashboard (si falta, `row-{idx}`) |
| `widget` | referencia `owner.name`, p. ej. `host.stat` |
| `label` | título propio de esta instancia |
| `params` | valores como `[[nombre, valor], …]` |
| `style` | `StyleSpec` de la instancia |
| `span`, `col`, `row`, `rows` | caja en la rejilla de 12 |

## Opción B: desde la app

```json
// describe() de la app
{
  "dashboards": [{
    "id": "ops-overview",
    "label": "Operaciones",
    "route": "/ops-overview",
    "default": false,
    "style": { "gap_px": 16, "padding_px": 24 },
    "widgets": [
      { "id": "borradores", "widget": "host.stat",
        "params": [["doctype", "Task"], ["docstatus", "0"], ["title", "Borradores"]],
        "span": 3, "rows": 2 },
      { "id": "tendencia", "widget": "host.trend",
        "params": [["doctype", "Task"], ["days", "30"]], "span": 6, "rows": 4 }
    ]
  }]
}
```

La app declara; el Desk **siembra**. Sobre esa semilla se guarda el override
compartido, y desde ese momento la fila guardada manda.

## Reglas de la ruta

* La ruta es obligatoria y la valida el servidor contra los prefijos reservados
  del Desk. Una ruta inutilizable **descarta** el dashboard del feed y deja un
  aviso en el log; no se pinta a medias.
* Las rutas son únicas entre dashboards. Un duplicado se descarta igual.
* Como mucho **uno** es `default`: el primero registrado gana y el resto se
  rechaza con un aviso.
* El catch-all de la tabla de rutas (`/*rest`) resuelve la ruta declarada en el
  cliente; el servidor registra solo las rutas que existen de verdad, así que una
  URL desconocida da 404 en una carga directa.

## Geometría y estilo

* `span` va de 1 a 12; `rows` de 1 a 64; cada fila mide 72 px.
* Un `size`/`min` declarado en la definición del widget fija el tamaño de partida
  y el mínimo al que el builder deja encoger.
* Un widget sin celdas (`col`/`row` ausentes) se coloca en el primer hueco libre
  al normalizar. Por eso una semilla escrita a mano no necesita coordenadas.
* El estilo se resuelve en tres niveles: global del Desk → declarado → override
  guardado. El de la instancia solo compite con el de su definición.

:::tip
Si dos widgets se solapan, no edites el JSON a mano: el servidor normaliza al
guardar y devuelve la lista ya colocada. Esa respuesta es lo que hay que mirar.
:::

## Editarlo

Quien tenga el derecho de edición entra en modo edición desde la top bar:

1. arrastra para mover y usa la esquina para redimensionar (se confirma al soltar);
2. abre la paleta y añade widgets del catálogo, agrupados por `category`;
3. ajusta título, subtítulo, tamaño y parámetros en el panel de propiedades;
4. guarda: se envía la lista completa y la configuración del tablero.

"Cancelar" restaura la instantánea de la entrada al modo edición, no la semilla
original.

## Permisos

Editar un dashboard significa escribir la fila compartida `Dashboard Layout`
(`{owner}:{dashboard}`). El derecho que lo gobierna es el `create` de ese DocType,
que por defecto tiene el rol administrador; conceder ese permiso a otro rol abre la
edición de dashboards a ese rol. `delete` se controla igual y hace volver a la
semilla.

En un dashboard que **es** un documento (`document` binding), el gate es `Write`
sobre ese documento: no hay override por usuario, lo que guarda uno lo ve todo el
mundo.

Un widget puede además declarar `requires`; si la capacidad no está disponible, el
cuerpo no se monta y el resto del tablero sigue.

## Comprobación manual

1. Crea el `Dashboard` con dos widgets y abre su `route`: aparece la rejilla.
2. Recarga: el orden y las celdas son los mismos (normalización estable).
3. Mueve un widget, guarda y abre la URL en otro navegador: el cambio es
   compartido, porque el override es uno solo.
4. Quita el `route` o duplícalo: el dashboard desaparece del feed y el log dice
   por qué.
5. Entra con un usuario sin el derecho de edición: no hay paleta ni asas, y la
   rejilla se ve igual.
6. Marca `is_default` en dos documentos: solo uno responde en `/`.

:::caution
Un dashboard declarado en una app y otro en un documento con la misma ruta no se
fusionan: uno de los dos se descarta. Comprueba las rutas antes de duplicar un
tablero para "probar".
:::

Ver [Dashboards y widgets](/0.2/frontend/dashboards-y-widgets/) para el modelo interno
y [Widgets](/0.2/guias/widgets/) para el cuerpo de cada tarjeta.
