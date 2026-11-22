---
title: Campos y fieldtypes
description: Las propiedades de un campo, los 46 fieldtypes canónicos y qué
  valida realmente el motor.
slug: 0.2/conceptos/campos-y-fieldtypes
---

Un campo se declara como `ferris_schema::FieldMeta` y viaja al navegador como
`ferris_schema::contract::DynField`. El segundo es un subconjunto: el Desk solo
recibe lo que necesita para renderizar. El `fieldtype` no es una etiqueta de
presentación: decide qué se valida al escribir y qué control dibuja el Desk.

## Propiedades de `FieldMeta`

### Identidad y valor

| Propiedad | Tipo | Para qué |
|---|---|---|
| `fieldname` | `String` | Nombre dentro del documento y del blob JSON. |
| `label` | `Option<String>` | Etiqueta visible; si falta, se usa el `fieldname`. |
| `fieldtype` | `String` | Uno de los 46 nombres canónicos. |
| `options` | `Option<String>` | Lista de un `Select`, DocType destino de un `Link`/`Table`, campo de un `Image`, endpoint de un `Button`. |
| `default` | `Option<String>` | Valor inicial; se siembra al materializar un Single. |

### Comportamiento

| Propiedad | Efecto real |
|---|---|
| `reqd` | El motor rechaza el documento si el valor es nulo. |
| `read_only` | El Desk no ofrece edición; el motor no lo impone por sí solo. |
| `hidden` | Fuera del formulario. |
| `unique` | Unicidad declarada; se materializa al crear el índice. |
| `allow_on_submit` | Único caso en que un campo puede cambiar con `docstatus = 1`. |
| `no_copy` | Se excluye al duplicar. |
| `depends_on` | Expresión que decide si el campo se muestra. |
| `mandatory_depends_on` | Convierte el campo en obligatorio **según la expresión**, en el formulario. |
| `read_only_depends_on` | Lo vuelve de solo lectura según la expresión, en el formulario. |
| `fetch_from` | `"link_field.source_field"`: al cambiar el `Link`, copia el valor. |
| `fetch_if_empty` | Solo aplica `fetch_from` si el campo está vacío. |

:::caution[`depends_on` no es una regla de servidor]
`depends_on`, `mandatory_depends_on` y `read_only_depends_on` las evalúa el Desk.
El motor solo aplica `reqd`, los límites y el tipo. Si la regla es un invariante
de negocio, va en un hook `Validate`, no en la metadata de presentación.
:::

### Presentación y permisos

| Propiedad | Efecto |
|---|---|
| `in_list_view` | Columna disponible en la lista. |
| `in_standard_filter` | Filtro estándar de la lista. |
| `in_global_search` | Incluido en la búsqueda global. |
| `in_preview` | Visible en la vista previa de la lista. |
| `bold` | Etiqueta en negrita. |
| `columns` | Ancho en columnas de la rejilla (1–12). |
| `permlevel` | Nivel de permiso de campo. `0` es el documento; `> 0` exige una regla `DocPerm` con ese nivel y el derecho. |
| `precision`, `min_value`, `max_value`, `non_negative` | Restricciones numéricas. |
| `length`, `max_length` | Longitud (en **caracteres**, no bytes). |
| `read_only_on_load` | Editable al crear, bloqueado al abrir uno existente. |
| `collapsible`, `collapsible_depends_on`, `hide_border` | Agrupación visual de una sección. |
| `print_hide`, `report_hide`, `print_width`, `width` | Salida impresa e informes. |
| `remember_last_selected_value`, `in_filter` | Comodidad de selección. |
| `ignore_user_permissions`, `ignore_xss_filter`, `convert_to_user_timezone` | Ajustes finos de seguridad y zona horaria. |
| `virtual` | Campo calculado: no se persiste y es de solo lectura. |

`DynField` espeja el subconjunto con `#[serde(default)]` en todo lo opcional, así
que un payload sin esa propiedad sigue parseando. Añadir una propiedad es seguro;
renombrar una existente rompe a los Desk desplegados.

## Los 46 fieldtypes

La lista canónica vive en `ferris_schema::fieldtype::FIELDTYPES` y es la misma que
usa el renderer del Desk, el dispatch de validación y los generadores. Un nombre
fuera de ella se rechaza en las rutas estrictas (customización, descriptor WASM,
carga de DocType almacenado).

### Texto y contenido (13)

`Data`, `Text`, `Small Text`, `Long Text`, `Text Editor`, `Markdown Editor`,
`Code`, `HTML`, `HTML Editor`, `JSON`, `Read Only`, `Heading`, `Button`.

`Data` es una línea; `Text`/`Small Text`/`Long Text` son multilínea de distinta
capacidad; `Text Editor`, `Markdown Editor`, `HTML Editor` y `Code` son editores;
`HTML` no es un input (renderiza `options` como HTML desde la metadata); `JSON`
valida que el valor sea JSON; `Read Only` transporta un valor que el llamante no
edita; `Heading` es un rótulo y `Button` un botón que llama a `options`.

### Numéricos (6)

`Int`, `Float`, `Currency`, `Percent`, `Rating`, `Duration`.

`Int` es el único entero: `Long Int` no existe y el registro lo rechaza.
`Currency`, `Float` y `Percent` se validan como número, y `Percent` **no** acota a
0–100 por sí solo: hay que declarar `min_value`/`max_value`. `Rating` trae un
rango por defecto de 0 a 5 (una cota declarada lo sustituye, no lo estrecha).
`Duration` guarda segundos enteros y no admite negativos; el `HH:MM:SS` lo compone
el Desk antes de escribir.

### Fecha y hora (4)

`Date`, `Datetime`, `Time`, `Week`.

`Date` es `YYYY-MM-DD`; `Datetime` acepta RFC 3339 o `YYYY-MM-DD HH:MM:SS`;
`Time` acepta `HH:MM` o `HH:MM:SS`. `Week` (`YYYY-Www`) **no** tiene regla propia:
cae en el caso sin validación de tipo.

### Selección y relaciones (6)

`Select`, `Check`, `Link`, `Dynamic Link`, `Table`, `Table MultiSelect`.

`Select` valida contra las opciones separadas por salto de línea. `Link` y
`Dynamic Link` se validan como texto (la existencia del documento destino no se
comprueba en el motor). `Table` y `Table MultiSelect` apuntan a un DocType hijo y
su valor es un array de objetos.

### Archivos y media (8)

`Attach`, `Attach Image`, `Attachment Gallery`, `Image`, `File`, `Signature`,
`Barcode`, `Geolocation`.

`Attach`/`Attach Image` exigen una cadena (ruta o URL de fichero). `Signature`
exige un data URL base64 (`data:<mime>;base64,…`). `Geolocation` espera una
geometría o *feature collection* GeoJSON, y acepta también `"lat,lon"`.
`Attachment Gallery` no es un input: los ficheros viven en el gestor de archivos.

### Credenciales (2)

`Password`, `Secret`.

`Password` es de un solo sentido: se hashea al escribir y toda lectura devuelve
`PASSWORD_MASK`, incluido para System Manager; solo el almacén de autenticación
opta por ver el hash. `Secret` es recuperable: se cifra con AES-256-GCM y toda
lectura devuelve `SECRET_MASK`; el texto plano solo se obtiene por
`DocumentEngine::read_secret`, en un contexto de servidor de confianza. Escribir
un sobre ya cifrado se rechaza.

### Validadores de cadena (4)

`Email`, `Phone`, `URL`, `Color`.

Son extras de Ferris: Frappe los modela como `Data` con validación en `Options`.
Aquí el tipo implica la regla, y el motor la aplica.

### Layout (3)

`Tab Break`, `Section Break`, `Column Break`.

No llevan valor: solo ordenan el formulario. `fieldtype::is_layout` los reconoce.

## Nombre canónico

`fieldtype::canonical(name)` devuelve la grafía de cable o `None`. La comparación
es sensible a mayúsculas, como Frappe, y solo recorta espacios alrededor porque
el diálogo de personalización envía entrada cruda.

Un nombre desconocido (`Dat`, `Long Int`, `Icon`, `datetime`) devuelve `None` y
**se rechaza**; `"small text"` en minúsculas tampoco vale. No hay alias
camelCase: escribe siempre `Small Text`, `Dynamic Link`, `Table MultiSelect`…

:::note[Por qué hay una sola lista]
Un único normalizador evita que la macro, los builders y el Desk discrepen sobre
el nombre de un tipo. Si cada capa aceptara su propia grafía, un campo declarado
con la macro podría degradarse a un input de texto sin avisar.
:::

## Qué valida el motor

`ferris_document::validation::validate_field` aplica, en este orden:

1. `reqd` si el valor es nulo.
2. La regla del fieldtype: `Link`, `Select`, `Email`, `Phone`, `URL`,
   `Currency`/`Float`, `Int`, `Percent`, `Rating`, `Duration`, `Date`/`Datetime`/
   `Time`, `Check`, `JSON`, `Geolocation`, `Signature`, `Attach`/`Attach Image`.
3. `max_length` contando caracteres.
4. `min_value` y `max_value`.

Los tipos sin regla propia (`Text`, `Heading`, los breaks) solo pasan por 1, 3 y
4\. Un `Integer` mal escrito, un `Percent` con `"abc"` o una `Signature` con un
objeto se rechazan: no caen en el `_ => {}`.

## Añadir un fieldtype

No se puede desde fuera del workspace. La lista es una constante y hay un test
(`every_documented_frappe_fieldtype_is_known`) que fija los 38 fieldtypes
documentados por Frappe. Añadir uno implica tocar la lista, el renderer del Desk,
el dispatch de validación y ese test, en el mismo cambio.
