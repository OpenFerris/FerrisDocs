---
title: Índice
description: Los conceptos de Ferris ordenados por la pregunta que responde cada uno.
slug: 0.2/conceptos
---

Esta sección explica el vocabulario del framework en el orden en que se necesita.
No es una lista alfabética: cada página asume la anterior.

## Modelar datos

**[DocTypes](/0.2/conceptos/doctypes/)** — la unidad de modelado. Qué declara, cómo se
compila con `#[doctype]`, cómo se registra en runtime y cómo se relaciona con su
tabla.

**[Campos y fieldtypes](/0.2/conceptos/campos-y-fieldtypes/)** — las casi cincuenta
propiedades de un campo y los 46 fieldtypes canónicos, agrupados por familia.
Incluye el nombre canónico y qué rechaza el allowlist estricto.

**[Naming](/0.2/conceptos/naming/)** — cómo se acuña el `name`, que es la clave
primaria. Los nueve métodos de Frappe, el `Series` propio de Ferris, las Document
Naming Rules y el contador transaccional.

## Ciclo de vida

**[DocStatus](/0.2/conceptos/docstatus/)** — `0/1/2`, las transiciones válidas y qué
significa cada una en la base de datos y en el JSON.

**[Controladores y hooks](/0.2/conceptos/controladores/)** — los 19 `HookPoint`, el
registro global, la prioridad y cómo se reenvía un evento a un plugin WASM.

**[Workflows](/0.2/conceptos/workflows/)** — estados y transiciones con roles,
condiciones y campos obligatorios, por encima del DocStatus.

## Acceso

**[Permisos](/0.2/conceptos/permisos/)** — `PermissionRule`/DocPerm, el motor de
políticas con deny-wins, `if_owner`, `permlevel`, `Custom DocPerm` y `ReadScope`.

## Extensiones sin recompilar

**[Campos virtuales](/0.2/conceptos/campos-virtuales/)** — un campo que no se persiste y
se calcula al leer.

**[DocTypes virtuales](/0.2/conceptos/doctypes-virtuales/)** — un DocType entero cuyas
filas viven fuera de las tablas de documentos.

**[Actions, Links y Customize](/0.2/conceptos/actions-links-customize/)** — botones de
formulario, panel de Connections, Custom Fields, Property Setters y la postura del
proyecto sobre scripts.

## Qué página abrir según la pregunta

| Si te preguntas… | Abre |
|---|---|
| ¿Dónde declaro un campo? | [DocTypes](/0.2/conceptos/doctypes/) |
| ¿Qué tipos de campo existen? | [Campos y fieldtypes](/0.2/conceptos/campos-y-fieldtypes/) |
| ¿Por qué mi documento se llama `TASK-0042`? | [Naming](/0.2/conceptos/naming/) |
| ¿Por qué no puedo editar un documento enviado? | [DocStatus](/0.2/conceptos/docstatus/) |
| ¿Dónde meto la lógica de negocio? | [Controladores](/0.2/conceptos/controladores/) |
| ¿Cómo añado un estado de aprobación? | [Workflows](/0.2/conceptos/workflows/) |
| ¿Por qué un rol no ve un documento? | [Permisos](/0.2/conceptos/permisos/) |
| ¿Cómo añado un campo sin recompilar? | [Actions, Links y Customize](/0.2/conceptos/actions-links-customize/) |

## Por dónde seguir

Si acabas de llegar, el recorrido natural es:

```text
DocTypes → Campos y fieldtypes → Naming → DocStatus → Controladores → Permisos
```

Si lo que quieres es entender una escritura completa, salta a
[ciclo de vida](/0.2/arquitectura/ciclo-de-vida/) y
[el viaje de una petición HTTP](/0.2/arquitectura/peticion-http/).

:::tip[La regla que evita casi todos los errores]
Si una pantalla necesita un dato que no está en la metadata, el arreglo es extender
la metadata —un campo, un flag, una entrada del contrato—, no escribir el dato en
la vista. Todo lo demás se deriva.
:::
