---
title: Constructor de DocTypes (API)
description: Crear y editar DocTypes en runtime desde el Desk o una integración, con columnas y tablas hijas reales.
---

Ferris puede crear un `DocType` sin recompilar. La API de administración
registra la metadata, crea la tabla con las columnas reales de cada campo
(incluidas las tablas hijas) y guarda la fila en `tabDocType` con
`custom = true`.

## Crear

```http
POST /api/doctype
Content-Type: application/json

{
  "name": "Customer",
  "module": "CRM",
  "fields": [
    { "fieldname": "customer_name", "fieldtype": "Data", "label": "Name", "reqd": true },
    { "fieldname": "credit_limit", "fieldtype": "Currency" },
    { "fieldname": "addresses", "fieldtype": "Table", "options": "Customer Address" }
  ]
}
```

Responde `201` con la metadata efectiva. Solo un `System Manager` puede
llamarla; cualquier otro rol recibe `403`.

Antes de crear la tabla se valida:

- el nombre produce una tabla válida (`document_table`: letras, dígitos, `_`;
  los espacios se eliminan);
- no es un nombre del framework (`User`, `Role`, `DocType`, `Session`, …) ni
  empieza por `_`;
- los campos no se repiten y su `fieldtype` existe;
- un campo `Table` nombra en `options` un `DocType` ya registrado;
- un `DocType` hijo (`is_child_table: true`) no declara `parent`, `parenttype`,
  `parentfield` ni `idx`.

## Editar

```http
PUT /api/doctype/Customer
```

Solo se pueden editar los `DocType` con `custom = true`: los declarados en
código se sobrescribirían en el siguiente arranque y se rechazan.

Añadir un campo añade una columna **nullable** (`ALTER TABLE ... ADD COLUMN`).
Quitar un campo deja de servirlo pero **no borra la columna ni sus datos**, para
que un error de edición no destruya filas. No hay endpoint de borrado.

## Qué se materializa

- Columnas reales para `Data`, `Select`, `Link`, `Int`, `Float`,
  `Currency`, `Percent`, `Check`, `Date`, `Datetime`, `Text`, `JSON`, etc.
- Tablas hijas reales para cada campo `Table`, con `parent`, `parenttype`,
  `parentfield` e `idx`.
- La fila de metadata en `tabDocType`, que el siguiente arranque vuelve a leer.

Los tipos son nativos: `Date`/`Datetime` son `DATE`/`TIMESTAMP` o `DATETIME`
(`TEXT` en SQLite), `Currency`/`Percent` son `NUMERIC(21,9)` o `DECIMAL(21,9)`
(`NUMERIC` en SQLite), `Check` es `BOOLEAN` y `Float` es
`DOUBLE PRECISION`/`DOUBLE`/`REAL`. La lista del Desk todavía evalúa en Rust los filtros que no son de
columna.

## Ejemplo con tabla hija

```json
POST /api/doctype        → { "name": "Customer Address", "is_child_table": true,
                             "fields": [
                               { "fieldname": "city", "fieldtype": "Data" },
                               { "fieldname": "country", "fieldtype": "Data" }
                             ] }

POST /api/doctype        → { "name": "Customer",
                             "fields": [
                               { "fieldname": "customer_name", "fieldtype": "Data", "reqd": true },
                               { "fieldname": "addresses", "fieldtype": "Table",
                                 "options": "Customer Address" }
                             ] }
```

Crea primero el hijo: el padre lo resuelve al construir la tabla. Las filas del
hijo se escriben y se leen en la misma transacción que el padre.
