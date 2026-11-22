---
title: Referencia
description: "Índice de las tablas de referencia de Ferris: DocTypes incluidos,
  fieldtypes, errores, features del host y variables de entorno."
slug: 0.2/referencia
---

Estas páginas son catálogos, no tutoriales. Cada una responde a una pregunta
concreta con datos tomados del código, y enlaza a la guía que explica el porqué.

## Tablas

| Página | Responde a |
|---|---|
| [DocTypes incluidos](/0.2/referencia/doctypes-incluidos/) | ¿Qué DocTypes trae el framework y para qué sirve cada uno? |
| [Fieldtypes](/0.2/referencia/fieldtypes/) | ¿Qué tipos de campo existen, cómo viajan y cuáles son extra de Ferris? |
| [Errores](/0.2/referencia/errores/) | ¿Qué taxonomía de errores hay y a qué dominio pertenece cada uno? |
| [Features del host](/0.2/referencia/host-features/) | ¿Qué subsistemas compiló este binario y cómo se comprueba? |
| [Variables de entorno](/0.2/referencia/variables-entorno/) | ¿Qué variables lee el proceso y qué defaults tienen? |
| [Glosario](/0.2/referencia/glosario/) | ¿Qué significa DocType, Single, World, Capability…? |

## Datos de esta versión

| Dato | Valor |
|---|---|
| Versión de Ferris | `0.2.0` |
| Toolchain | Rust `1.98.1` |
| Contrato de plugins | `ferris:framework@0.2.0` |
| Crates del workspace | 22 |
| Fieldtypes canónicos | 46 |
| Interfaces WIT | `types`, `data`, `io`, `mqtt`, `platform`, `descriptor` |

## Convención de versiones

Las tablas describen la versión del repositorio (`0.2.0`, pre-1.0). La versión
de Cargo y la del paquete WIT son **la misma cifra**, y el significado de cada
salto (patch, minor, major) está en [Versionado](/0.2/referencia/versionado/).
Cuando una tabla y el código discrepen, el código es la verdad y la tabla es el
bug.

## Cómo leer una referencia

* Un nombre en `backticks` es literal: el de un DocType, un campo, una variable o
  una ruta. Si no coincide con el código, el código gana.
* Las tablas de esta sección no repiten los tutoriales. Para el flujo completo,
  usa [primeros pasos](/0.2/getting-started/) o [API HTTP](/0.2/api/).
* Los catálogos agrupan por dominio; no listan todos los campos de cada DocType.
  Para eso, la fuente es
  `GET /api/doctype/meta/{doctype}` en una instancia viva, o los ficheros
  `ferris-*/src/doctypes*` del repositorio.

## Qué NO vas a encontrar aquí

| Esperas | Dónde está en realidad |
|---|---|
| Un listado de todos los campos de un DocType | `GET /api/doctype/meta/{doctype}` |
| El catálogo de rutas HTTP | [API HTTP](/0.2/api/) y `ferris-api/src/router/routes.rs` |
| La lista de comandos del CLI | [CLI](/0.2/cli/) |
| La tabla de claves de `ferris.toml` | [configuración](/0.2/configuracion/) |
| El contrato WIT completo | [el contrato WIT](/0.2/apps/wit/) y `ferris-wasm/wit/ferris.wit` |

## Cómo se mantiene

Cada tabla se deriva de un fichero concreto, y esa es la prueba de que no es
inventada:

| Tabla | Fuente |
|---|---|
| DocTypes incluidos | `DoctypeMeta::new` en `ferris-*/src/doctypes*` |
| Fieldtypes | `ferris-schema/src/fieldtype.rs` (`FIELDTYPES`) |
| Errores | `ferris-core/src/error.rs` |
| Features | tablas `[features]` de `ferris-server` y `ferris-cli` |
| Variables de entorno | `std::env::var` en `ferris-core`, `ferris-cli`, `ferris-auth`, `ferris-server` |
| Glosario | tipos y conceptos que el código nombra |

Si cambias uno de esos ficheros, actualiza su tabla en el mismo cambio: una
referencia desactualizada es peor que no tenerla, porque parece autorizada.

:::tip[La referencia se queda corta por diseño]
Un catálogo exhaustivo de campos envejece en cada commit. Los nombres y las
categorías sí son estables; los detalles se consultan en el metadato del propio
servidor.
:::
