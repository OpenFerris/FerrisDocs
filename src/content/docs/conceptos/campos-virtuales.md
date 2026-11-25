---
title: Campos virtuales
description: Campos que no se persisten, se calculan al leer y son de solo lectura por construcción.
---

Un **campo virtual** (Virtual DocField en Frappe) existe en la metadata pero no en
el almacenamiento. Su valor se calcula cada vez que se lee el documento. Es la
forma de exponer un dato derivado —un total, un estado calculado, una fila de otra
fuente— sin duplicarlo en una columna ni mantenerlo sincronizado a mano.

## La declaración

```rust
FieldMeta::data("full_name")
    .label("Nombre completo")
    .virtual_field()
```

El flag es `virtual` en la metadata y viaja al Desk como `DynField.r#virtual`
(serializado como `"virtual"`, porque `virtual` es palabra reservada en Rust). El
formulario lo pinta de solo lectura; no es una sugerencia de UI, el motor lo
impone.

## Qué hace el motor

En cada lectura (`get`, `list`, `get_single`, y el final de un write) se llama a
`virtual_read`:

```text
1. redact_read(documento)          // quita Password/Secret y campos de permlevel alto
2. para cada campo con virtual:
     - si el llamante no puede leer ese permlevel → se elimina
     - si falta el proveedor → VirtualFieldProviderMissing
     - computed = provider(&documento_redactado)
     - documento[campo] = computed
3. redact_read(documento) otra vez // un virtual Password o restringido no filtra
```

El proveedor recibe el documento **ya redactado**: nunca ve un hash de contraseña
ni un campo que el llamante no pueda leer. Y la segunda redacción existe porque un
proveedor podría devolver un valor sensible bajo un nombre que sí se lee.

## El proveedor

```rust
pub type VirtualFieldProvider = fn(&Value) -> Result<Value>;
```

Es una función síncrona y pura a propósito. Una firma `async` necesitaría
`async_trait` o `Pin<Box<dyn Future>>`, que hace cada implementación más ruidosa que
el dato que calcula. Un proveedor que necesite I/O tiene su propio puente: bloquea
en su runtime, o precalcula en memoria y devuelve eso.

Registro, idempotente (re-registrar el mismo par sustituye):

```rust
use ferris_document::register_virtual_field;
use ferris_core::{Result, Value};

fn full_name(doc: &Value) -> Result<Value> {
    let first = doc.get("first_name").and_then(Value::as_str).unwrap_or("");
    let last = doc.get("last_name").and_then(Value::as_str).unwrap_or("");
    Ok(Value::from(format!("{first} {last}").trim().to_string()))
}

register_virtual_field("Contact", "full_name", full_name);
```

`register_virtual_field` y `register_virtual_doctype` se re-exportan desde la raíz
de `ferris_document`.

## Escritura: rechazada, no ignorada

Un body que trae un campo virtual se rechaza con
`DocumentError::VirtualFieldReadOnly`, nombrando el campo. Aceptarlo sería el
"éxito silencioso" que el proyecto prohíbe: el valor se guardaría y la siguiente
lectura lo sobrescribiría, dejando al llamante creyendo que persistió algo.

El rechazo ocurre antes de los hooks, tanto en insert como en update, así que
ningún controlador puede observar ni transformar el valor enviado.

## Errores tipados

| Error | Cuándo |
|---|---|
| `VirtualFieldProviderMissing { doctype, field }` | La metadata declara `virtual` pero nadie registró el proveedor. |
| `VirtualFieldReadOnly { doctype, field }` | Un body intenta escribir el campo. |

El primero es un error y no un `Null`: un campo declarado que no
se puede calcular es una configuración incompleta, y devolver vacío la escondería.

## Child tables virtuales

No hay un caso especial. Si el campo virtual declara `fieldtype = "Table"` y su
`options` apunta a un DocType hijo, el proveedor devuelve un **array de objetos** y
el motor lo inserta como cualquier otro valor calculado:

```rust
fn open_lines(doc: &Value) -> Result<Value> {
    let rows = doc.get("lines").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(Value::Array(rows))
}

register_virtual_field("Invoice", "pending_lines", open_lines);
```

El DocType hijo sigue declarándose con `is_child_table`; lo único distinto es que
nadie lo persiste en el padre.

## Coste: se ejecuta por fila

`virtual_read` corre **una vez por fila** en `list`. Un proveedor que hace una
llamada remota por documento convierte una página en un N+1. El motor no lo oculta:
un campo virtual se espera barato y puro. Si necesitas agregación, calcula por lote
en tu lado y cachea; no pidas al motor que lo haga por ti.

:::caution[No sustituye a un campo persistido]
Un virtual no se puede filtrar en SQL, no se puede indexar y no se puede ordenar en
la base de datos. Si la lista tiene que ordenar o filtrar por ese valor, guárdalo
en un campo real (y mantenlo con un hook `Validate` o `BeforeSave`).
:::

## Cuándo usarlo

- Un valor derivado de otros campos del mismo documento (`full_name`, `total`).
- Un dato de otra tabla que se quiere mostrar sin duplicarlo (estado de una
  integración).
- Una child table de solo lectura calculada a partir de datos existentes.

## Cuándo no

- Si necesitas filtrar u ordenar por él en la lista.
- Si el cálculo es caro y la lista tiene muchas filas.
- Si el valor debe quedar registrado en `tab_version`: un virtual no aparece
  como campo almacenado, porque nunca se almacenó.
