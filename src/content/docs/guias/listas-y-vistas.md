---
title: Receta — listas y vistas
description: Cómo una vista de colección sale de la metadata, cómo enlazarla desde el Desk y cómo añadir filtros, columnas y acciones masivas sin codificar DocTypes.
---

Una vista de colección no se escribe: se **declara**. La ruta trae el DocType y la
metadata trae columnas, filtros y modos. Esta receta cubre cómo aprovecharlo y
dónde sí hay que tocar código.

## La regla: nada codificado

```rust
// mal
let rows = store.list("Sales Invoice", &params).await;

// bien
let doctype = params.with(|p| p.get("doctype").unwrap_or_default());
let rows = store.list(&doctype, &params).await;
```

El `:module` y el `:doctype` de la URL son la única fuente. Un DocType escrito a
mano en una vista es un defecto: no cambia con la metadata, no respeta renombrados
y rompe la app en cuanto el DocType no existe en esa instalación.

:::tip
Si necesitas una vista para un DocType concreto, declara sus campos y sus modos en
la metadata. La vista genérica ya sabe dibujarlos; lo que no sabe es inventarse un
DocType que no existe.
:::

## 1. Columnas

```rust
use ferris_schema::{DoctypeMeta, FieldMeta};

DoctypeMeta::new("Proyecto", "Projects")
    .field(FieldMeta::data("titulo").label("Título").in_list_view())
    .field(FieldMeta::select("estado", "Abierto\nEn curso\nCerrado")
        .label("Estado")
        .in_list_view())
    .field(FieldMeta::date("inicio").label("Inicio").in_list_view())
```

`in_list_view` decide qué columnas ve el usuario por defecto. El orden por defecto
es `creation desc`; el usuario puede cambiarlo y su elección se guarda en la
`SavedView` de ese DocType. El selector **Columnas** de la barra de la lista
muestra u oculta cualquier columna de la metadata (también las del sistema, como
`Created`); la elección se guarda en la misma `SavedView` y «Restablecer
columnas» vuelve al conjunto declarado. Nunca se puede ocultar la última columna.

Para columnas que no son campos, declara un campo virtual (`virtual`) o deja que la
vista compuesta calcule la presentación: no añadas una columna “de mentira” a la
metadata.

## 2. Filtros

Dos conjuntos, sin pisarse:

- **rápidos**: los campos `in_standard_filter` más los `Select`/`Check`;
- **avanzados**: todos los de `filter_fields(meta)`.

```rust
DoctypeMeta::new("Proyecto", "Projects")
    .field(FieldMeta::link("cliente", "Customer").label("Cliente").in_standard_filter())
    .field(FieldMeta::check("archivado").label("Archivado").in_standard_filter())
```

Un filtro nuevo se declara una vez y aparece en las dos superficies. Filtrar
resetea la página: pedir “página 3 del filtro nuevo” devolvería filas de otro
conjunto.

## 3. Enlazar la vista

Desde la sidebar, un workspace declara el item:

```rust
WorkspaceSpec::new("projects", "Proyectos")
    .module("Projects")
    .item(Item::doctype("Proyecto"))
```

`Item::doctype` deja que el feed del Desk resuelva el módulo y el `href` del
DocType. Si escribes la URL a mano, un DocType movido de módulo deja el enlace
roto.

Para una vista concreta, la URL es explícita y vive bajo el propio DocType:

| Vista | Ruta |
|---|---|
| Lista | `/desk/{module}/{doctype}` o `/desk/{module}/{doctype}/list` |
| Kanban | `/desk/{module}/{doctype}/kanban` |
| Calendario | `/desk/{module}/{doctype}/calendar` |
| Árbol | `/desk/{module}/{doctype}/tree` |
| Gantt | `/desk/{module}/{doctype}/gantt` |
| Informe | `/desk/{module}/{doctype}/report` |

Las formas cortas (`/kanban/:doctype`, `/calendar/:doctype`, `/tree/:doctype`,
`/gantt/:doctype`, `/report/:doctype`) siguen existiendo para enlaces externos y
marcadores guardados; el selector de vistas de la barra superior navega siempre a
la forma canónica.

La vista que abre el índice la declara el DocType (`default_view`). La primera
visita de la sesión a `/desk/{module}/{doctype}` redirige a esa vista; `…/list`
sigue siendo la forma explícita de abrir la lista y no se redirige.

## 4. Ajustes por vista

Las vistas leen su configuración de la metadata. Se edita en **Ajustes del
DocType** (menú `⋯` del editor de diseño), pestaña por pestaña, y cada valor se
guarda como `Property Setter`. El servidor valida el campo y su tipo al guardar:
un nombre inexistente o un tipo que el renderizador no sabe usar se rechaza con
un error, no se guarda para ignorarse después.

| Vista | Ajustes |
|---|---|
| Lista | `sort_field`, `sort_order`, `search_fields` |
| Kanban | `kanban_group_field`, `kanban_card_fields` |
| Calendario | `date_field`, `calendar_end_field`, `calendar_title_field` |
| Árbol | `tree_parent_field`, `tree_label_field`, `tree_expanded_levels` |
| Gantt | `gantt_start_field`, `gantt_end_field`, `gantt_dependency_field`, `gantt_progress_field` |
| General | `default_view` |

## 5. Kanban

El tablero agrupa por `kanban_group_field`: un `Select` **multi-valor** (las
columnas son sus opciones, en el orden declarado) o un `Link` (las columnas son
los valores presentes en los documentos). Si el DocType no declara ninguno, se
mantiene la regla histórica —el primer `Select` con varias opciones— y, si
tampoco hay, los grupos salen de solo lectura sobre `docstatus`: un `docstatus`
se cambia con submit/cancel, nunca con un `update`.

```rust
DoctypeMeta::new("Tarea", "Projects")
    .in_kanban()
    .kanban_group_field("estado")
    .kanban_card_fields(["prioridad", "due_date"])
    .field(FieldMeta::select("estado", "Pendiente\nEn curso\nHecha\nCancelada")
        .label("Estado"))
```

Mover una tarjeta es una escritura real: se aplica de forma optimista, se espera
la respuesta y, si el servidor la rechaza, la tarjeta vuelve a su columna y el
error se muestra. Las flechas de la tarjeta son la alternativa de teclado al
arrastre.

## 6. Calendario

`date_field` es el día del documento; `calendar_end_field` (opcional) lo
convierte en un evento de varios días y `calendar_title_field` cambia el texto de
la tarjeta. Sin `date_field` se usa `creation` y la vista lo **dice**. La
navegación es por mes o por semana, con «Hoy» y creación por día.

## 7. Árbol

`tree_parent_field` debe ser un `Link` a este mismo DocType. La vista anida los
documentos, expande los niveles de `tree_expanded_levels` en la primera apertura,
guarda la expansión por DocType y filtra por búsqueda mostrando el camino a cada
coincidencia. Un padre desconocido o un ciclo no hace desaparecer filas: el
documento se pinta como raíz. Sin campo padre, la vista explica qué falta y
enlaza a los ajustes.

## 8. Gantt

Primera versión funcional: una rejilla de días con una barra por documento entre
`gantt_start_field` y `gantt_end_field`. `gantt_progress_field` (Percent, Int o
Float) rellena la barra y `gantt_dependency_field` muestra «después de …». No
dibuja flechas de dependencia ni permite arrastrar la barra: mover fechas desde
el Gantt sería una escritura que esta versión no hace.

## 9. Acciones masivas

El Desk ya trae recargar, exportar página, exportar selección y eliminar
selección. Lo que añade una app va en `list.toolbar.bulk`:

```rust
// La app declara el slot para el doctype; el Desk lo monta en la barra.
// El elemento recibe el doctype y la selección en sus atributos.
```

Mientras haya filas marcadas, el menú de selección de la top bar aparece; sin
selección, el mismo botón no se dibuja.

Reglas:

- una acción masiva es **una** petición al servidor, no N escrituras desde el
  navegador;
- confirma antes de destruir (el borrado usa diálogo);
- el resultado se anuncia en un toast y la lista recarga;
- los `Callback` de las acciones se crean en el cuerpo de la vista, nunca en el
  efecto que publica la barra.

## 10. Acciones por fila

`list.row.actions` se monta una vez por fila visible, en la celda final, con
`data-row` en el nombre del registro. Es el sitio para "abrir en la app", "enviar
a revisión" o un menú propio. Cuidado con el coste: la tabla está virtualizada, así
que solo existen las filas del viewport.

## 11. Estados y honestidad

Toda colección pinta **cargando**, **vacío** y **error**, y los distingue:

- vacío por falta de documentos ≠ vacío por un filtro que no devuelve nada;
- error con el mensaje del servidor y un botón de reintento;
- truncado cuando la página se corta, en lugar de mostrar una lista incompleta
  como si fuera todo.

`loading` arranca en `true`: es lo que permite que SSR y la primera pasada de
hidratación pinten la misma rama.

## Comprobación manual

1. Abre `/desk/{module}/{doctype}` con dos DocTypes distintos: columnas y filtros
   cambian, no hay estado residual del anterior.
2. Ordena por una columna, recarga: el orden persiste.
3. Marca tres filas, exporta la selección y elimina: el total baja en tres.
4. Filtra hasta cero resultados: el mensaje dice que el filtro no devuelve nada.
5. Entra por `/kanban/{doctype}` y mueve una tarjeta a un estado sin permiso de
   escritura: el movimiento debe fallar visible, no “volver sola”.

Ver [Listas y tablas](/frontend/listas/) para el modelo interno.
