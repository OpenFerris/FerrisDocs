---
title: Versionado y compatibilidad
description: Una sola versión para Cargo y para el contrato WIT, qué significa
  cada salto y cómo se publica una versión de Ferris.
slug: 0.2/referencia/versionado
---

Ferris usa **un único número de versión**. El workspace lo declara en
`Cargo.toml` (`[workspace.package] version`) y el contrato de apps lo declara en
`ferris-wasm/wit/ferris.wit`:

```toml
# Cargo.toml
[workspace.package]
version = "0.2.0"
```

```wit
// ferris-wasm/wit/ferris.wit
package ferris:framework@0.2.0;
```

Las dos copias del contrato (`ferris-wasm/wit/ferris.wit` y
`test/wit/ferris.wit`) son **byte a byte idénticas**. Un test de `ferris-wasm`
falla si la versión de Cargo y la del paquete WIT no coinciden, o si las dos
copias divergen. No hay una versión "de Cargo" y otra "de WIT" que puedan
desincronizarse.

## Qué significa el número

El número describe **compatibilidad**, no cantidad de cambios:

| Cambio | Versión | Efecto en una app existente |
|---|---|---|
| Corrección, rendimiento, documentación, refactor interno | `0.2.0` → `0.2.1` | Ninguno: el WIT no cambia |
| Nueva capacidad del WIT, compatible hacia atrás (desde 1.0.0) | `1.0.0` → `1.1.0` | La app sigue instanciando; puede ignorar lo nuevo |
| Ruptura (desde 1.0.0) | `1.1.0` → `2.0.0` | La app debe recompilarse y adaptarse |
| Cualquier cambio mientras Ferris sea `0.x` | `0.2.0` → `0.3.0` | Pre-1.0: puede romper; fija un tag |

En otras palabras:

* **patch** (`x.y.Z`): nada del contrato cambia. Se puede actualizar sin tocar
  el componente.
* **minor** (`x.Y.z`): desde `1.0.0`, el contrato crece de forma
  retrocompatible: una app compilada contra la versión anterior sigue
  funcionando y una app nueva puede usar lo añadido. En `0.x` una minor todavía
  puede romper.
* **major** (`X.y.z`): el contrato rompe. Una app de la major anterior no
  instancia hasta que se recompile y se adapte. El salto a `1.0.0` es la primera
  versión estable y también puede romper lo que existía en `0.x`.

## Estado actual: 0.2.0 es pre-1.0

Ferris todavía está en `0.x`, así que **no hay garantía de compatibilidad entre
versiones menores**. `0.2.0` es la versión actual; un `0.3.0` puede cambiar la
API o el WIT si el diseño lo necesita. La regla estricta de patch/minor/major
empieza en `1.0.0`, la primera versión estable.

Para cualquier despliegue duradero, fija un tag o un commit concreto. El
binario y el contrato WIT de ese tag son el contrato real de tu instalación.

:::note[Por qué el WIT usa la misma versión que Cargo]
Un componente se enlaza por el nombre completo de la interfaz, que incluye la
versión (`ferris:framework/data@0.2.0`). Si el paquete WIT y el binario
declararan números distintos, el host y el guest hablarían de contratos
diferentes aunque el código fuente fuera el mismo. Una sola cifra elimina esa
clase de error.
:::

## Qué cuenta como ruptura

Estos cambios suben la **major**:

* eliminar o renombrar una función, un tipo, un campo de un record, una variante
  de un enum o una interfaz entera;
* cambiar el tipo de un parámetro o de un resultado;
* añadir un requisito nuevo a un export que ya existía (por ejemplo, un
  parámetro obligatorio);
* cambiar el significado de un valor sin cambiar su tipo (un `auth-mode` que
  ahora se interpreta al revés).

Estos cambios son **minor**:

* añadir una función nueva a una interfaz existente;
* añadir una interfaz nueva al world;
* añadir una variante a un enum marcado como abierto o una entrada a
  `platform::features()`;
* añadir un campo opcional al final de un record, si el contrato lo documenta
  como aditivo.

Un **patch** no toca `ferris.wit` en absoluto: solo código del host, del Desk,
de la CLI, documentación o tests.

## Publicar una versión

1. Sube la versión en `Cargo.toml` y en las dos copias de `ferris.wit` a la vez.
2. Reconstruye los fixtures del contrato:
   `cargo build --target wasm32-wasip2 --manifest-path test/Cargo.toml` y los
   tres probes de `ferris-wasm/tests/fixtures/`.
3. Ejecuta los tests de `ferris-wasm` (incluye el guard de versión) y el resto
   de gates de [Pruebas](/0.2/contribuir/pruebas/).
4. Actualiza `CHANGELOG.md` con la versión y el tipo de cambio.
5. Archiva la documentación de la versión anterior (ver abajo).

## Documentación versionada

El sitio publica la documentación **actual** en `/` y conserva una copia por
versión en `/<version>/`, por ejemplo `/0.2/`. El selector de versión de la
cabecera cambia entre la copia actual y las archivadas sin perder la página que
estás leyendo.

* La copia actual es el trabajo en curso; en el selector aparece como la versión
  con el sufijo `dev`.
* Cada versión publicada se archiva con `starlight-versions`; la copia queda
  congelada y no recibe los cambios posteriores.
* Una página nueva entra automáticamente en las dos salidas para LLMs
  (`/llms.txt` y `/llms-full.txt`); las copias archivadas se excluyen de ese
  índice para que un agente lea siempre la versión actual.
