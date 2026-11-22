---
title: Fieldtypes
description: Los 47 fieldtypes canónicos de Ferris, su valor de wire y los extras que no están en Frappe.
---

La lista canónica vive en `ferris_schema::fieldtype::FIELDTYPES`. El **nombre de wire** es el de Frappe, con espacios y mayúsculas exactas
(`Small Text`, no `SmallText`); no hay alias camelCase. `fieldtype::canonical(name)` resuelve el nombre y devuelve `None`
para cualquier otro; la ruta de escritura de personalización, el registro de
plugins y la carga de DocTypes almacenados **rechazan** un `None`.

Un `fieldtype` no es una columna SQL: el motor guarda el documento como JSON y
valida/renderiza según el tipo. Siete tipos llevan lógica propia en Ferris.

## Catálogo

| Fieldtype | Grupo | Notas |
|---|---|---|
| `Data` | texto | Cadena corta; el tipo por defecto |
| `Text` | texto | Texto de varias líneas |
| `Small Text` | texto | Texto medio |
| `Long Text` | texto | Texto largo |
| `Text Editor` | texto | Editor enriquecido (HTML saneado) |
| `Markdown Editor` | texto | Markdown; el Desk lo previsualiza |
| `Code` | texto | `options` declara el lenguaje |
| `HTML` | texto | Bloque HTML de solo lectura |
| `HTML Editor` | texto | HTML editable — **extra de Ferris** |
| `JSON` | texto | Objeto o array serializado; se valida al escribir |
| `Password` | secreto | Se hashea; al leer llega una máscara, no el valor |
| `Secret` | secreto | Cifrado AES-256-GCM, recuperable por contexto confiable — **extra** |
| `Phone` | texto | Valida formato telefónico — **extra** |
| `Email` | texto | Valida dirección de correo — **extra** |
| `URL` | texto | Valida URL — **extra** |
| `Color` | texto | Color con selector; cadena de color — **extra tipado** |
| `Select` | elección | `options` separadas por `\n` |
| `Link` | relación | `options` es el DocType destino; el motor comprueba que no esté vacío |
| `Dynamic Link` | relación | El destino lo nombra otro campo (`options`) |
| `Table` | tabla | Tabla hija; `options` es el DocType hijo |
| `Table MultiSelect` | tabla | Varias filas de un DocType hijo enlazado |
| `Check` | booleano | `0`/`1` |
| `Int` | número | Entero |
| `Float` | número | Decimal; `precision` |
| `Currency` | número | Importe con moneda |
| `Percent` | número | Porcentaje; `min_value`/`max_value` |
| `Rating` | número | Valoración |
| `Duration` | número | Duración como número |
| `Date` | fecha | Fecha ISO (`YYYY-MM-DD`) |
| `Datetime` | fecha | Fecha y hora |
| `Time` | fecha | Hora |
| `Week` | fecha | Semana ISO — **extra de Ferris** |
| `Image` | medio | Imagen con vista previa |
| `File` | medio | Fichero — **extra** (Frappe usa `Attach`) |
| `Attach` | medio | Adjunto (`File`) |
| `Attach Image` | medio | Adjunto restringido a imagen |
| `Attachment Gallery` | medio | Galería de imágenes |
| `Signature` | medio | Firma dibujada |
| `Barcode` | medio | Código de barras |
| `Geolocation` | medio | Coordenadas |
| `Read Only` | presentación | Muestra un valor calculado |
| `Button` | presentación | Acción, no dato |
| `Heading` | presentación | Solo rótulo de sección — **extra** |
| `Tab Break` | layout | Abre una pestaña; no lleva valor |
| `Section Break` | layout | Abre una sección; no lleva valor |
| `Column Break` | layout | Abre una columna; no lleva valor |
| `Widget` | widget | Widget del Desk renderizado en el formulario; `options` es `<app>/<widget>` y no lleva valor — **extra** |

`is_layout(name)` reconoce los tres breaks en ambas grafías. Ni los breaks ni
`Widget` almacenan valor en el documento.

## Los extras de Ferris

Frappe documenta 38 fieldtypes (los cubre un test de cobertura). Ferris añade
nueve:

| Extra | Por qué existe |
|---|---|
| `Week` | Semana ISO como tipo propio |
| `File` | Un fichero del store, no solo un adjunto |
| `Heading` | Elemento de formulario solo con rótulo |
| `Secret` | Credencial **recuperable** (OAuth client secret, clave de webhook), cifrada, no un hash irreversible como `Password` |
| `HTML Editor` | HTML editable |
| `Phone` | Valida formato en vez de dejarlo a `Data` + `options` |
| `Email` | Ídem para correo |
| `URL` | Ídem para URL |
| `Widget` | Un widget del Desk renderizado en el formulario; `options` nombra `<app>/<widget>` y no viaja en el payload |

`Secret` es el caso que más importa: declarar una credencial recuperable como`Password` la guarda como hash y la devuelve enmascarada para siempre. `Secret`
la cifra y permite `read_secret` a un contexto de confianza.

## Dónde se usa el nombre

| Consumidor | Qué hace |
|---|---|
| Macro `#[field(type = "…")]` | Valida en compilación; emite el nombre canónico |
| Builders (`FieldMeta::data`, `::link`, …) | Emiten el canónico |
| `describe()` de un plugin | El host valida con `canonical` antes de registrar |
| `POST /api/customization/{doctype}/fields` | Rechaza un tipo desconocido |
| Desk | Elige el widget de edición por `fieldtype` |
