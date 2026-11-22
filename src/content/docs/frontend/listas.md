---
title: Listas y tablas
description: ListView sobre ViewCore, columnas y filtros por metadata, orden, paginación con scroll virtual, selección múltiple y engagement.
---

La lista es la vista índice de un DocType (`/desk/:module/:doctype`). Todo lo que
muestra sale de la metadata: columnas, filtros rápidos, campos de filtro
avanzado y modos de vista.

## Composición

```text
ListView (views/list_view.rs)
  └── ListService (views/services/list_service.rs)
        └── ViewCore + ViewService (views/services/view_core.rs)
              └── DocStore  (SSR en proceso | cliente REST)
```

`ListService` añade solo lo que tiene sentido en una tabla: orden por columna,
visibilidad de columnas, filtros rápidos y engagement. **No** reimplementa la
carga, el filtrado ni la selección: eso vive en `ViewCore` y se alcanza por el
trait `ViewService`.

```rust
pub struct ListService {
    pub core: ViewCore,
    pub order_by: RwSignal<String>,          // "creation desc"
    pub visible_cols: RwSignal<HashSet<String>>,
    pub quick_filters: RwSignal<Vec<Filter>>,
    pub only_liked: RwSignal<bool>,
    pub engagement: RwSignal<EngagementPage>,
    pub all_columns: Memo<Vec<Column>>,
    pub visible_columns: Memo<Vec<Column>>,
    pub standard_filters: Memo<Vec<Column>>,
    // …
}
```

Los filtros rápidos y los avanzados son señales **distintas** a propósito: uno no
borra al otro. Ambos se persist en la vista guardada (`SavedView`).

## Columnas por metadata

`all_columns` viene de `list_columns(meta)`; `visible_columns` filtra por el
conjunto guardado. Sin nada guardado, el conjunto está vacío y se muestran las
columnas por defecto de la metadata (`in_list_view`). El menú **Columnas**
(`ListColumnPicker`) es su único escritor: materializa el «todas» implícito antes
de ocultar una y nunca deja la tabla sin columnas. El orden por defecto es
`creation desc`: una lista que arranca en orden de creación descendente es la que
el usuario espera tras crear algo.

`split_order("creation desc")` devuelve `("creation", true)`; sin dirección,
ascendente. El orden se envía al motor en el `ListParams`, nunca se aplica en
memoria sobre la página cargada.

## Filtros

| Origen | Dónde se edita | Persistencia |
|---|---|---|
| Filtros rápidos | fila sobre la tabla (`ListQuickFilters`) | `ListExtra.quick_filters` |
| Filtro avanzado | agrupador (`ListFilterGroup`) | `SavedView::filters` |
| Orden | menú de columna (`ListOrderByGroup`) | `ListExtra.order_by` |
| Solo favoritos | corazón de la cabecera | estado de sesión |

Los campos que ofrece el constructor avanzado son
`filter_fields(meta)`; los rápidos son `standard_filter_fields(meta)` más los
`Select`/`Check` del DocType. Un campo que la metadata no declare no aparece.

:::tip
Cada cambio de filtro entra en el mismo `ListParams` que la paginación, así que
filtrar **resetea** la página: pedir "página 3 del filtro nuevo" devolvería filas
de otro conjunto.
:::

## Paginación y scroll virtual

`LIST_PAGE_SIZE` es 20. La tabla (`components/views/list/table.rs`) virtualiza el
cuerpo: solo construye las filas alrededor del viewport, y al acercarse al final
del conjunto cargado pide la página siguiente.

- La cabecera es sticky y queda **fuera** de la ventana virtual.
- `LOAD_MORE_THRESHOLD` (4 filas) da el margen de antelación para que el append no
  se note.
- El scroll se lee con `use_virtual_scroll`, que expone `start_index`/`end_index`
  como señales.

El total y la página se leen del `ApiResponse` del servidor (`rows`, `total`). No
se cuentan filas en el cliente.

## Selección y acciones masivas

La selección es un conjunto de nombres; las acciones se publican en la top bar
como `TopBarAction` y, cuando hay filas marcadas, en el menú de selección
(`SelectionMenuSpec`):

- **recargar** la página actual;
- **exportar** la página cargada o solo la selección (con las columnas visibles);
- **eliminar** la selección, con diálogo de confirmación;
- acciones adicionales declaradas por plugins en `list.toolbar.bulk`.

Los `Callback` de esas acciones se crean **en el cuerpo del componente**, una sola
vez. Un `Callback` creado dentro del efecto que publica la barra pertenece a la
arena de esa ejecución: en el siguiente re-render, el botón visible apuntaría a un
valor muerto.

## Engagement

`engagement` trae en **una** petición el estado de "me gusta" y el número de
comentarios de todas las filas visibles (`DocStore::engagement`). Pedirlo por fila
sería un N+1 sobre la tabla entera. El corazón de la cabecera filtra por
`only_liked`.

## Estados

Toda lista pinta tres estados y no los confunde:

1. **cargando** — `ListLoadingSkeleton`, que es también lo que el SSR deja hasta
   que el cliente resuelve;
2. **vacío** — `ListEmptyBlock`, que distingue "no hay documentos" de "el filtro
   no devuelve nada";
3. **error** — `ListErrorBanner` con el mensaje del servidor y un reintento.

`loading` arranca en `true`: si empezara en `false`, la primera pasada
de hidratación pintaría el estado vacío donde el servidor reservó el skeleton y la
estructura saltaría al hidratar.

## Slots

| Slot | Uso |
|---|---|
| `list.before_table` | banners o barras sobre el resultado |
| `list.toolbar.bulk` | acciones masivas de la app |
| `list.row.actions` | acciones por fila (`data-row` con el nombre) |

## Otras vistas de colección

- `KanbanView`: agrupa por un campo `Select` multi-valor de la metadata. Mover una
  tarjeta **espera** la escritura y solo después recarga; un `docstatus` no se
  mueve por `update`, así que ese grupo sale de solo lectura.
- `CalendarView`: agrupa por el campo de fecha declarado (`date_field`), con
  fallback a `creation` y un aviso cuando ocurre.
- `ReportView`: filtros declarados en el informe y tabla de resultados.

Ninguna de las tres codifica un DocType: el `:doctype` de la ruta y su metadata lo
deciden todo.

Siguiente: [Dashboards y widgets](/frontend/dashboards-y-widgets/) y la
[receta de listas](/guias/listas-y-vistas/).
