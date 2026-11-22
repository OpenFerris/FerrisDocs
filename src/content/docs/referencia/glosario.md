---
title: Glosario
description: Los términos que Ferris usa con un significado propio, en una frase cada uno.
---

## Modelo de datos

**DocType**
La unidad de modelado: un nombre, un módulo, campos, permisos y flags. Se declara
en Rust o en el `describe()` de una app. Es a la vez el esquema y el formulario.

**DocField**
Un campo de un DocType: `fieldname`, `fieldtype`, `label`, `options`, `reqd`,
`permlevel`, etc. En la base de datos es una fila de la tabla `DocField`, hija de
`DocType`.

**Fieldtype**
El tipo de un DocField (`Data`, `Select`, `Table`, `Secret`, …). Son 47 nombres
canónicos; ver [fieldtypes](/referencia/fieldtypes/).

**DocPerm**
La regla de permisos de un rol sobre un DocType: `read`, `write`, `create`,
`delete`, `submit`, `if_owner`, `permlevel`. Vive en `tabDocPerm`.

**DocStatus**
El estado del ciclo de vida: `0` borrador, `1` enviado, `2` cancelado. Un
documento enviado no se edita ni se borra; se cancela y se enmienda.

**Single**
Un DocType con exactamente un documento, nombrado igual que el DocType. Se sirve
por `/api/single/{doctype}` y no admite crear ni borrar.

**Child table**
Un DocType que solo existe dentro de otro (`Table`/`Table MultiSelect`). Sus
filas llevan `parent`, `parenttype`, `parentfield` e `idx`.

**Virtual (DocType o campo)**
Un DocType o campo cuyo valor no está almacenado, sino que lo sirve un proveedor
registrado. Escribirlo se rechaza con `VirtualFieldReadOnly`: el valor se calcula
al leer.

**Naming Series**
El patrón con el que se genera el `name` de un documento (`TASK-.#####`). El tipo
de naming puede ser `series`, `uuid`, `auto`, `field`, `prompt` o `script`.

**Módulo**
La sección del Desk a la que pertenece un DocType (`Build`, `Users`, `Email`,
`Printing`, …). Agrupa, no autoriza.

**Workspace**
Una entrada de navegación del Desk: enlaces, atajos, gráficas y tarjetas. Se
declara en código o en el DocType `Workspace`.

## Frontend

**Desk**
La aplicación de administración de Ferris: formularios, listas, kanban,
calendario, dashboards, permisos y personalización. Es una app Leptos con SSR e
hidratación, servida en `/desk`.

**Desk route**
Una ruta del Desk: `/desk/{module}/{doctype}` para la lista y
`/desk/{module}/{doctype}/{name}` para el documento. El tercer segmento también
puede ser `list`, `kanban`, `calendar` o `layout`.

**DocStore**
La fachada de acceso a datos del frontend. `DocStore::Server` en SSR,
`DocStore::Client` en el navegador. Una vista nunca llama a `fetch` directamente.

## Plugins y extensibilidad

**WIT**
WebAssembly Interface Types: el contrato estático entre el host y un plugin.
Ferris publica `ferris:framework@0.3.0` en `ferris-wasm/wit/ferris.wit`, con
seis interfaces: `types`, `data`, `schema`, `io`, `platform`, `descriptor`.

**World** (mundo)
El directorio propio de una app, `plugins/<app>/`, montado en `/world` dentro del
sandbox. Contiene `customizations/`, `data/`, `files/` y `secrets/`. Es el único
sitio del disco que el guest puede escribir.

**Capability**
Un permiso que la app **declara** en `describe()` y que el host concede al
instanciarla (`routes`, `filesystem`, `streams`, `scheduler`, …). Una
llamada fuera del conjunto efectivo falla con `permission-denied`.

**Feature**
Un subsistema compilado en el binario (`web`, `realtime`, `print`, …). Es distinto
de una capability: la feature dice qué **puede** hacer el host; la capability,
qué le **has concedido** a una app. Ver
[features del host](/referencia/host-features/).

**Descriptor / `describe()`**
La exportación con la que una app declara DocTypes, rutas, métodos, temas,
workspaces, widgets y suscripciones. Es un valor tipado del WIT, no JSON libre.

**Hook**
Código que el motor ejecuta en un punto del ciclo de vida (validación, antes o
después de guardar, submit, cancel). En plugins, el punto equivalente es
`doctype-event`.

## Operación

**Site / tenant**
Una instalación con su propia base de datos, ficheros y apps. `ferris tenant`
gestiona los ficheros de tenant; `TenantConfig` guarda host, base de datos y
correo del admin.

**Feature matrix**
La comparación entre lo compilado (`host_features`) y lo pedido en
`[features]`. Un desajuste es un error de arranque, no un warning.

**bench**
En Frappe, la herramienta de línea de órdenes que crea sitios y arranca
procesos. En Ferris ese papel lo cubre el binario `ferris` (`new`, `dev`,
`serve`, `migrate`, `doctor`); `ferris benchmark` es el subcomando de medición,
no un reemplazo de `bench`.

**Doctype Action / DocType Link**
Filas que añaden botones al formulario y grupos al panel Connections. No son
código: son datos del sitio.

**Customize / Property Setter**
La capa de personalización en tiempo de ejecución: campos añadidos (`Custom
Field`) y propiedades sobrescritas (`Property Setter`), incluido `insert_after`
para reordenar campos efectivos.

:::tip[Dónde se define cada término]
Cada entrada apunta a una página que lo desarrolla. Si un término no aparece
aquí, busca en [DocTypes incluidos](/referencia/doctypes-incluidos/) o en la
[ruta del código](/arquitectura/crates/).
:::
