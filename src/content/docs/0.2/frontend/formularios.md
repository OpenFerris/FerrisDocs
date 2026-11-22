---
title: Formularios
description: FormService, el modelo FormField, el layout por tabs y secciones,
  la validación, el payload y las acciones del ciclo de vida.
slug: 0.2/frontend/formularios
---

El formulario de documento es genérico: se construye desde `DynMeta` y el
documento, nunca desde una lista de campos escrita a mano. Lo dirige
`FormService` (`views/services/form_service/`), y la vista (`views/form_view/`)
solo coloca.

## FormService

El servicio recibe las tres rutas como **señales**, no como `String`. Así un
cambio de `TASK-0001` a `TASK-0002` no deja el servicio congelado en el documento
anterior: la ruta actualiza la señal y el servicio la lee.

```rust
pub fn new(
    doctype: Signal<String>,
    module: Signal<String>,
    docname: Signal<String>,
) -> Self
```

Estado que la vista lee:

| Señal | Contenido |
|---|---|
| `meta`, `fields`, `title`, `docstatus`, `doc` | metadata, campos reactivos y documento crudo |
| `loading`, `saving`, `error`, `notice` | estados de la carga y del guardado |
| `dirty` | memo: el payload actual difiere del último cargado/guardado |
| `sections`, `tab_labels`, `default_tab` | layout derivado |
| `is_new`, `is_single`, `layout_mode` | modo de la ruta |
| `is_submittable`, `allow_cancel`, `allow_amend`, `allow_delete` | permisos por transición |
| `last_write` | resultado pendiente de anunciar en un toast |

`baseline` es una huella del payload, no de los campos: un campo que el usuario
escribió y luego borró **no** deja el formulario sucio, porque el guardado
enviaría lo mismo.

## FormField

`FormField` combina metadata y estado reactivo:

```rust
pub struct FormField {
    pub fieldname: String,
    pub label: String,
    pub fieldtype: String,
    pub options: Option<String>,
    pub reqd: bool,
    pub read_only: bool,
    pub depends_on: Option<String>,
    pub fetch_from: Option<String>,
    pub fetch_if_empty: bool,
    pub is_name: bool,
    pub value: RwSignal<String>,
    pub checked: RwSignal<bool>,
    pub error: RwSignal<Option<String>>,
    // …
}
```

`build_form_fields(meta, doc, is_new)` inyecta en modo `new` un campo sintético
`ID` (`is_name: true`) cuyo aspecto depende de la estrategia de naming: `Series`
editable y prellenada, `Prompt` obligatoria, y `AutoIncrement`/`Uuid`/`Field`/
`Script`/`Expression` en solo lectura porque las genera el motor.

## Layout: tabs → secciones → columnas

`Tab Break`, `Section Break` y `Column Break` son campos de metadata que el
constructor usa como marcas. `build_form_layout` los consume y
`form_layout(fields)` devuelve la tupla que pinta la vista:

```rust
let (tab_labels, default_tab, sections) = form_layout(&fields);
```

Una pestaña sin campos se descarta (es un callejón sin salida). Un `HTML` no es
marca de layout: fluye como campo normal y dibuja un bloque. Los campos que
aparecen antes del primer `Tab Break` pertenecen a ese tab.

`FormSection` guarda `tab`, `heading`, `cols` y `items`, donde cada item es
`FormSectionItem::Field(idx)` o `Table(idx)`. La misma derivación alimenta el
panel de parámetros de un widget.

## Solo lectura efectiva

Se decide al cargar, donde el documento está a mano:

```rust
read_only: fm.read_only
    || fm.r#virtual
    || docstatus == 2
    || (docstatus == 1 && !fm.allow_on_submit),
```

Es decir: un documento cancelado queda bloqueado del todo; uno enviado conserva
editable solo lo declarado `allow_on_submit`; un campo virtual nunca se edita.
Además, `strip_virtual_fields` quita esos campos del payload antes de escribir,
porque el motor rechaza un valor en un virtual.

## `depends_on`

La condición se evalúa en el navegador, así que no se le entrega a un motor de
JavaScript. `condition.rs` implementa un subconjunto puro y sin efectos:

* referencias a campos (`status`, o `doc.status` con prefijo estilo Frappe);
* literales de cadena, número y `true`/`false`/`null`;
* `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!` y paréntesis;
* un prefijo `eval:` opcional.

No hay aritmética, ni llamadas, ni acceso a propiedades más allá de `doc.`.
Una expresión malformada **muestra** el campo: una errata en metadata no debe
esconder algo que el usuario necesita para guardar.

Un campo oculto tampoco bloquea el guardado aunque sea obligatorio, porque
`validate_form` salta los invisibles.

## `fetch_from`

`fetch_from` se escribe `"origen.destino"`: al cambiar el `Link` de `origen`, se
copia `destino` del documento enlazado. El efecto lee el valor del enlace, pide el
documento al `DocStore` y escribe el campo destino; con `fetch_if_empty` la copia
solo ocurre si el destino está vacío.

## Validación

`validate_form` recorre los campos visibles y limpia el error de cada uno:

* un campo `read_only` se salta (no se puede corregir desde la UI) y un `Check`
  no tiene estado inválido posible; el chequeo de filas de una `Table` se hace
  antes de ese salto;
* `Table` exige al menos una fila (el valor es el array serializado, así que
  "no vacío" se mide en filas, no en texto);
* los tipos de layout, `HTML`, `Button`, `Attachment Gallery` y `Heading` se
  saltan;
* los numéricos comprueban parseo, `min_value`/`max_value` y que un `Int` no
  tenga parte fraccionaria; `Email`, `Phone` y `Table MultiSelect` tienen su
  propia regla;
* `JSON` debe parsear a objeto o array.

Devuelve `bool` y escribe en `field.error`, que el renderer pinta junto al campo.

## Payload

`build_form_payload` es la única forma de texto → JSON que se envía:

| Fieldtype | Regla |
|---|---|
| `Check` | booleano |
| `Int` | entero; `7.5` se descarta en lugar de escribirse mal |
| `Float`/`Currency`/`Percent` | número (acepta `,` decimal del usuario) |
| `Datetime` | `YYYY-MM-DD HH:MM:SS` |
| `Table` | array; un valor que no parsea se **omite**, nunca se convierte en `[]` |
| `Table MultiSelect` | array de nombres (`parse_name_list`) |
| `JSON` | objeto o array |
| resto | cadena, omitida si está vacía |

El campo sintético `ID` se omite cuando sigue siendo la plantilla de serie
(contiene `#`) o está vacío, para que el motor acuñe el nombre real.

## Acciones y ciclo de vida

`save_action`, `submit_action`, `cancel_action`, `amend_action`,
`delete_action` y `duplicate_action` viven en `StoredValue` y comparten el
pipeline de `writes.rs`:

1. fijan `pending_write` con un `WriteVerb`;
2. `use_mutation` marca la petición en vuelo;
3. un único efecto decide que la escritura terminó y emite `WriteOutcome`;
4. la top bar lo convierte en un toast y limpia la señal.

`duplicate_payload` parte de `build_form_payload` y elimina `name` y `docstatus`:
la copia no puede heredar ni la identidad ni la posición en el ciclo de vida.

:::caution
Duplicar abre una copia del documento, no un formulario vacío: la copia parte del
original y no hereda ni la identidad ni la posición en el ciclo de vida. Y en modo
layout todas las escrituras se rechazan con un mensaje explícito: ese formulario
edita la estructura, no un registro.
:::

## Slots de extensión

| Slot | Dónde |
|---|---|
| `form.before_fields` | entre la cabecera y las pestañas |
| `form.after_fields` | tras las pestañas, antes de las acciones |
| `form.sidebar.top`, `form.sidebar.bottom` | columna lateral (solo existe si algo la declara) |
| `form.toolbar.left`, `form.toolbar.right` | esquinas de la barra superior |
| `form.view` | **reemplaza** el formulario entero para ese DocType |

`form.view` exige declarar el `doctype`: un plugin no puede sustituir todos los
formularios por accidente. Recibe `data-doc`, `data-docstatus`, `data-doctype`,
`data-name`, `data-module` y `data-props`.

Ver también [Listas y tablas](/0.2/frontend/listas/) y la
[receta de formularios](/0.2/guias/formularios/).
