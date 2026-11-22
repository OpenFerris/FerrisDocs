---
title: Referencia
description: "Índice de las tablas de referencia de Ferris: DocTypes incluidos, fieldtypes, errores, features del host y variables de entorno."
---

Estas páginas son catálogos, no tutoriales. Cada una responde a una pregunta
concreta con datos tomados del código, y enlaza a la guía que explica el porqué.

## Tablas

| Página | Responde a |
|---|---|
| [DocTypes incluidos](/referencia/doctypes-incluidos/) | ¿Qué DocTypes trae el framework y para qué sirve cada uno? |
| [Fieldtypes](/referencia/fieldtypes/) | ¿Qué tipos de campo existen, cómo viajan y cuáles son extra de Ferris? |
| [Errores](/referencia/errores/) | ¿Qué taxonomía de errores hay y a qué dominio pertenece cada uno? |
| [Features del host](/referencia/host-features/) | ¿Qué subsistemas compiló este binario y cómo se comprueba? |
| [Variables de entorno](/referencia/variables-entorno/) | ¿Qué variables lee el proceso y qué defaults tienen? |
| [Glosario](/referencia/glosario/) | ¿Qué significa DocType, Single, World, Capability…? |

## Datos de esta versión

| Dato | Valor |
|---|---|
| Versión de Ferris | la de `[workspace.package] version` en `FerrisCore/Cargo.toml` y `FerrisFramework/Cargo.toml`, copiada a `FerrisDocs/project.json` |
| Toolchain | Rust `1.98.1` |
| Contrato de plugins | el mismo número, `ferris:framework@<versión>` |
| Crates del workspace | 21 |
| Fieldtypes canónicos | 46 |
| Interfaces WIT | `types`, `data`, `io`, `platform`, `descriptor` |

La versión no se repite aquí: `astro.config.mjs` la lee de `project.json` (el
dato que el release sincroniza con los dos `Cargo.toml` y el WIT) y la inyecta
en el pie y en el selector.

## Convención de versiones

Las tablas describen la versión actual del repositorio (pre-1.0). La versión
de Cargo y la del paquete WIT son **la misma cifra**, y el significado de cada
salto (patch, minor, major) está en [Versionado](/referencia/versionado/).
Cuando una tabla y el código discrepen, el código es la verdad y la tabla es el
bug.

## Cómo leer una referencia

- Un nombre en `backticks` es literal: el de un DocType, un campo, una variable o
  una ruta. Si no coincide con el código, el código gana.
- Las tablas de esta sección no repiten los tutoriales. Para el flujo completo,
  usa [primeros pasos](/getting-started/) o [API HTTP](/api/).
- Los catálogos agrupan por dominio; no listan todos los campos de cada DocType.
  Para eso, la fuente es
  `GET /api/doctype/meta/{doctype}` en una instancia viva, o los ficheros
  `ferris-*/src/doctypes*` del repositorio.

## Qué NO vas a encontrar aquí

| Esperas | Dónde está en realidad |
|---|---|
| Un listado de todos los campos de un DocType | `GET /api/doctype/meta/{doctype}` |
| El catálogo de rutas HTTP | [API HTTP](/api/) y `ferris-api/src/router/routes.rs` |
| La lista de comandos del CLI | [CLI](/cli/) |
| La tabla de claves de `ferris.toml` | [configuración](/configuracion/) |
| El contrato WIT completo | [el contrato WIT](/apps/wit/) y `ferris-wasm/wit/ferris.wit` |

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
