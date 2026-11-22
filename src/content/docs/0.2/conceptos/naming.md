---
title: Naming
description: Cómo se acuña el nombre de un documento, qué método gana y cómo
  funciona el contador transaccional.
slug: 0.2/conceptos/naming
---

El `name` de un documento es su clave primaria, su identificador en la URL y el
valor que aparece en `data.name`. Acuñarlo es responsabilidad del motor, y la
estrategia se declara en el DocType, no se improvisa en el llamante: así dos
clientes no pueden inventar formatos distintos para el mismo DocType.

## Los nueve métodos (más uno)

`ferris_schema::contract::NamingType` reproduce los nueve métodos que documenta
Frappe y añade `Series`, propio de Ferris:

| `NamingType` | Opción de Frappe | Qué hace |
|---|---|---|
| `Prompt` | **Set by user** | El llamante debe enviar `name`; el motor no acuña. Si falta: `NameRequired`. |
| `AutoIncrement` | **Autoincrement** | Contador numérico puro (`1`, `2`, …), con clave propia por DocType. |
| `Field` | **By fieldname** | El nombre es el valor del campo declarado en `naming_field`. |
| `NamingSeries` | **By Naming Series field** | Formatea el patrón que trae el **documento** en su campo `naming_series`. |
| `Expression` | **Expression** | Plantilla separada por puntos: `EXAMPLE-.MM.-test-.{campo}.-.#####`. |
| `ExpressionOldStyle` | **Expression (old style)** | Una plantilla con llaves: `EXAMPLE-{MM}-{campo}-{#####}`. |
| `Random` | **Random** | Nombre aleatorio de 10 caracteres, no secuencial. |
| `Uuid` | **UUID** | UUID v4 opaco. |
| `Script` | **Script** | Un proveedor Rust registrado, no un script Python. |
| `Series` | *(propio de Ferris)* | Patrón estático del DocType, p. ej. `TASK-.#####`. |

`Series` no es lo mismo que `NamingSeries`: en `Series` el patrón vive en la
metadata del DocType; en `NamingSeries` vive en un campo de cada documento, de
modo que dos documentos del mismo DocType pueden seguir series distintas
(`SINV-` y `CINV-`).

## Resolución

```rust
NamingType::resolve(explicit, &naming_series)
```

Si el DocType declara `naming_type`, ese gana siempre. Si no declara nada y
`naming_series` no está vacío → `Series`; si no hay serie → `Uuid`. Esa regla se
aplica en un solo sitio, así que el motor y el Desk no pueden discrepar sobre lo
que hace un DocType sin declaración. El Desk la usa para decidir si el campo del id
es editable:

```rust
pub fn is_engine_owned(self) -> bool {
    !matches!(self, Self::Prompt | Self::Field)
}
```

Escrito como lista de excepciones a propósito: un método nuevo es de solo lectura
por defecto, que es el lado seguro para un identificador.

## Prioridad real al insertar

```text
1. BeforeNaming (puede fijar `name` directamente)
2. Document Naming Rule que case (salvo en un Child DocType)
3. ctx.naming_type
```

Si tras `BeforeNaming` el `name` sigue vacío, se acuña. En un **Single** no se
acuña nada: el nombre es el del DocType (`DoctypeMeta::single_name`), porque una
serie acuñaría un segundo nombre y la lectura por nombre fijo no lo encontraría.

## Document Naming Rule

Es metadata opcional (tabla `tabDocumentNamingRule`). Si la tabla no existe, hay
cero reglas: eso no es un error.

Selección:

* se descartan las reglas con `disabled` verdadero y las de otro `document_type`;
* se ordenan por `priority` **descendente**, con el nombre de la fila como
  desempate (dos reglas de la misma prioridad no pueden aplicarse en orden distinto
  entre procesos);
* gana la primera que **case** con el documento.

Condiciones, en sus dos formas:

```json
// lista de condiciones, todas AND
{ "conditions": [ { "field": "company", "condition": "=", "value": "ACME" } ] }

// forma con apply_if
{ "apply_if": "Fieldname", "fieldname": "company" }
{ "apply_if": "Condition", "condition": "qty > 10" }
```

Operadores admitidos: `=`, `==`, `!=`, `<>`, `>`, `<`, `>=`, `<=`. Compara número
contra número cuando ambos lo son, y texto en caso contrario. Un operador
desconocido es un `400`, no un "no case": evaluar código arbitrario es justo lo
que este proyecto no hace.

Formato del nombre:

```text
{prefix}{counter:0{prefix_digits}$}
```

* `prefix` es literal.
* `prefix_digits` (o `digits`) es el ancho; por defecto `5`.
* `counter` se incrementa y se persiste sobre el **mismo `WriteSink`** que la
  escritura: dentro de un `apply` o `create_bulk` participa de su transacción, así
  que un rollback del lote no quema un número.

## El contador: `tab_series`

`NamingSeriesStore` implementa el contador sobre una tabla de dos columnas:

```rust
Column::new("name", "VARCHAR(255)").not_null().primary_key(),
Column::new("current", "BIGINT").not_null().default("0"),
```

Cada acuñación hace, dentro de una transacción:

```sql
INSERT ... ON CONFLICT DO NOTHING   -- asegura la fila sin pisarla
UPDATE tab_series SET current = current + 1 WHERE name = ?
SELECT current FROM tab_series WHERE name = ?
```

Y rechaza un contador negativo con `DocumentError::NamingSeriesExhausted`.

Claves distintas por estrategia, para que no colisionen entre sí:

| Estrategia | Clave |
|---|---|
| Serie | el patrón (`TASK-.#####`) |
| Autoincrement | `autoincrement:<DocType>` |
| Expression | `expression:<DocType>:<patrón>` |
| Expression old style | `expression_old_style:<DocType>:<patrón>` |

`next_via` acepta un `WriteSink`, así que el contador puede acuñarse dentro de la
transacción de un `apply` o un `create_bulk`. Una transacción nueva ahí abriría una
segunda conexión (deadlock con un pool de una conexión) y escaparía del rollback
del batch. La tabla se asegura **antes** de abrir la transacción: DDL dentro de
una transacción es exactamente lo que este diseño evita.

## Formatos de plantilla

**`Series`** (`TASK-.#####`) entiende, tras un punto: una tirada de `#`, `YY`,
`YYYY`, `MM` y `DD`. Todo lo demás es literal.

**`Expression`** separa por `.` y concatena sin separador, así que el patrón trae
sus propios guiones. Cada parte puede ser: una tirada de `#` → el contador, una
sola vez por patrón; un token de fecha (`YYYY`, `YY`, `MM`, `DD`, `WW`, `HH`,
`mm`, `ss`, `timestamp`), con guiones alrededor permitidos; un nombre de campo sin
llaves (`{campo}` también vale); o texto literal.

**`ExpressionOldStyle`** es una sola cadena con llaves: `{#####}` es el contador,
`{YYYY}`/`{MM}`/… son fechas, `{campo}` es un valor del documento. Un token
desconocido se deja tal cual para que un error de escritura se vea en el nombre
generado. **`Random`** produce 10 caracteres del alfabeto `0-9a-v` (base32hex, sin
relleno), el mismo que Frappe, a partir de los bytes de un UUID v4.

## `Script`: un proveedor Rust

No hay intérprete embebido. Un DocType que declara `Script` necesita un proveedor
registrado:

```rust
use ferris_document::{register_naming_provider, EngineContext};
use ferris_core::{Result, Value};

fn next_ticket(doc: &Value, _ctx: &EngineContext<'_>) -> Result<String> {
    let area = doc.get("area").and_then(Value::as_str).unwrap_or("GEN");
    let seq = doc.get("seq").and_then(Value::as_i64).unwrap_or(0);
    Ok(format!("{area}-{seq}"))
}

register_naming_provider("Ticket", next_ticket);
```

`NamingProvider` es `fn(&Value, &EngineContext<'_>) -> Result<String>`. Recibe el
documento tal como quedó tras `BeforeNaming` y el contexto (DocType, usuario).
Re-registrar el mismo DocType **sustituye** el proveedor, así que una recarga del
dev-server es idempotente. Si no hay proveedor:
`DocumentError::NamingScriptUndeclared`; si devuelve cadena vacía:
`ValidationError::Invalid`.

## Sufijo de amend

Una copia enmendada se llama `NAME-1`, `NAME-2`, … (`naming::next_amend_name`).
La búsqueda es un `LIKE 'NAME-%'` acotado a las enmiendas de ese documento, con
`ESCAPE '!'` para ser portable (MySQL trata la barra invertida dentro de un
literal), y después comprueba explícitamente que el candidato no exista. Un número
liberado no se reutiliza.

## Errores de naming

| Error | Cuándo |
|---|---|
| `NameRequired` | `Prompt` sin `name`. |
| `NamingFieldUndeclared` | `Field` sin `naming_field`. |
| `NamingFieldEmpty` | `Field` con el campo vacío. |
| `NamingSeriesMissing` | `NamingSeries` sin valor ni patrón por defecto. |
| `NamingScriptUndeclared` | `Script` sin proveedor registrado. |
| `NamingSeriesExhausted` | Contador negativo. |
