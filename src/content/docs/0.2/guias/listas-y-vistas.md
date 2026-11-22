---
title: Receta — listas y vistas
description: Cómo una vista de colección sale de la metadata, cómo enlazarla
  desde el Desk y cómo añadir filtros, columnas y acciones masivas sin codificar
  DocTypes.
slug: 0.2/guias/listas-y-vistas
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
`SavedView` de ese DocType.

Para columnas que no son campos, declara un campo virtual (`virtual`) o deja que la
vista compuesta calcule la presentación: no añadas una columna “de mentira” a la
metadata.

## 2. Filtros

Dos conjuntos, sin pisarse:

* **rápidos**: los campos `in_standard_filter` más los `Select`/`Check`;
* **avanzados**: todos los de `filter_fields(meta)`.

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

Para una vista concreta, la URL es explícita:

| Vista | Ruta |
|---|---|
| Lista | `/desk/{module}/{doctype}` |
| Kanban | `/desk/{module}/{doctype}/kanban` o `/kanban/{doctype}` |
| Calendario | `/desk/{module}/{doctype}/calendar` o `/calendar/{doctype}` |
| Informe | `/report/{name}` |

Las formas cortas (`/kanban/:doctype`, `/calendar/:doctype`) siguen existiendo
para enlaces externos y marcadores guardados.

## 4. Kanban

El tablero agrupa por un campo `Select` **multi-valor** de la metadata. Si el
DocType no tiene ninguno, los grupos se muestran pero sin mover: no hay destino
válido para un arrastre.

```rust
DoctypeMeta::new("Tarea", "Projects")
    .field(FieldMeta::select("estado", "Pendiente\nEn curso\nHecha\nCancelada")
        .label("Estado"))
```

Mover una tarjeta es una escritura real: se espera la respuesta y solo entonces se
recarga. Un `docstatus` nunca se mueve por `update` (eso es submit/cancel), así
que ese grupo sale de solo lectura en lugar de ofrecer una flecha que el motor va a
rechazar.

## 5. Calendario

El campo de fecha sale del DocType (`date_field`). Si no hay ninguno, se agrupa por
`creation` y la vista lo **dice**, en lugar de fingir que ese era el campo
previsto. El `:doctype` de la ruta manda; `?doctype=` solo se acepta como valor
inicial para no romper un enlace guardado.

## 6. Acciones masivas

El Desk ya trae recargar, exportar página, exportar selección y eliminar
selección. Lo que añade una app va en `list.toolbar.bulk`:

```rust
// La app declara el slot para el doctype; el Desk lo monta en la barra.
// El elemento recibe el doctype y la selección en sus atributos.
```

Mientras haya filas marcadas, el menú de selección de la top bar aparece; sin
selección, el mismo botón no se dibuja.

Reglas:

* una acción masiva es **una** petición al servidor, no N escrituras desde el
  navegador;
* confirma antes de destruir (el borrado usa diálogo);
* el resultado se anuncia en un toast y la lista recarga;
* los `Callback` de las acciones se crean en el cuerpo de la vista, nunca en el
  efecto que publica la barra.

## 7. Acciones por fila

`list.row.actions` se monta una vez por fila visible, en la celda final, con
`data-row` en el nombre del registro. Es el sitio para "abrir en la app", "enviar
a revisión" o un menú propio. Cuidado con el coste: la tabla está virtualizada, así
que solo existen las filas del viewport.

## 8. Estados y honestidad

Toda colección pinta **cargando**, **vacío** y **error**, y los distingue:

* vacío por falta de documentos ≠ vacío por un filtro que no devuelve nada;
* error con el mensaje del servidor y un botón de reintento;
* truncado cuando la página se corta, en lugar de mostrar una lista incompleta
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

Ver [Listas y tablas](/0.2/frontend/listas/) para el modelo interno.
