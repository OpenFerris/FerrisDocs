---
title: Índice
description: Los conceptos de Ferris ordenados por la pregunta que responde cada uno.
---

Esta sección explica el vocabulario del framework en el orden en que se necesita.
No es una lista alfabética: cada página asume la anterior.

## Modelar datos

**[DocTypes](/conceptos/doctypes/)** — la unidad de modelado. Qué declara, cómo se
compila con `#[doctype]`, cómo se registra en runtime y cómo se relaciona con su
tabla.

**[Campos y fieldtypes](/conceptos/campos-y-fieldtypes/)** — las casi cincuenta
propiedades de un campo y los 47 fieldtypes canónicos, agrupados por familia.
Incluye el nombre canónico y qué rechaza el allowlist estricto.

**[Naming](/conceptos/naming/)** — cómo se acuña el `name`, que es la clave
primaria. Los nueve métodos de Frappe, el `Series` propio de Ferris, las Document
Naming Rules y el contador transaccional.

## Ciclo de vida

**[DocStatus](/conceptos/docstatus/)** — `0/1/2`, las transiciones válidas y qué
significa cada una en la base de datos y en el JSON.

**[Controladores y hooks](/conceptos/controladores/)** — los 19 `HookPoint`, el
registro global, la prioridad y cómo se reenvía un evento a un plugin WASM.

**[Workflows](/conceptos/workflows/)** — estados y transiciones con roles,
condiciones y campos obligatorios, por encima del DocStatus.

## Acceso

**[Permisos](/conceptos/permisos/)** — `PermissionRule`/DocPerm, el motor de
políticas con deny-wins, `if_owner`, `permlevel`, `Custom DocPerm` y `ReadScope`.

## Extensiones sin recompilar

**[Campos virtuales](/conceptos/campos-virtuales/)** — un campo que no se persiste y
se calcula al leer.

**[DocTypes virtuales](/conceptos/doctypes-virtuales/)** — un DocType entero cuyas
filas viven fuera de las tablas de documentos.

**[Actions, Links y Customize](/conceptos/actions-links-customize/)** — botones de
formulario, panel de Connections, Custom Fields, Property Setters y la postura del
proyecto sobre scripts.

## Qué página abrir según la pregunta

| Si te preguntas… | Abre |
|---|---|
| ¿Dónde declaro un campo? | [DocTypes](/conceptos/doctypes/) |
| ¿Qué tipos de campo existen? | [Campos y fieldtypes](/conceptos/campos-y-fieldtypes/) |
| ¿Por qué mi documento se llama `TASK-0042`? | [Naming](/conceptos/naming/) |
| ¿Por qué no puedo editar un documento enviado? | [DocStatus](/conceptos/docstatus/) |
| ¿Dónde meto la lógica de negocio? | [Controladores](/conceptos/controladores/) |
| ¿Cómo añado un estado de aprobación? | [Workflows](/conceptos/workflows/) |
| ¿Por qué un rol no ve un documento? | [Permisos](/conceptos/permisos/) |
| ¿Cómo añado un campo sin recompilar? | [Actions, Links y Customize](/conceptos/actions-links-customize/) |

## Por dónde seguir

Si acabas de llegar, el recorrido natural es:

```text
DocTypes → Campos y fieldtypes → Naming → DocStatus → Controladores → Permisos
```

Si lo que quieres es entender una escritura completa, salta a
[ciclo de vida](/arquitectura/ciclo-de-vida/) y
[el viaje de una petición HTTP](/arquitectura/peticion-http/).

:::tip[La regla que evita casi todos los errores]
Si una pantalla necesita un dato que no está en la metadata, el arreglo es extender
la metadata —un campo, un flag, una entrada del contrato—, no escribir el dato en
la vista. Todo lo demás se deriva.
:::
