---
title: ferris app
description: Instalar, listar, habilitar y retirar apps del catálogo global apps/, con validación contra el host antes de publicar.
---

`ferris app` gestiona el **catálogo global** de apps: el directorio `apps/` de
un bench, donde `ferris build` deja el paquete y del que `ferris site
install-app` copia a un sitio. No hay registro ni base de datos: el componente
`.wasm`, su `plugin.toml` y su plantilla `world/` son la app.

El comando necesita la feature `wasm`, que está en el conjunto por defecto. En
una compilación mínima (`--no-default-features --features api`) no existe.

## Subcomandos

| Comando | Efecto |
|---|---|
| `ferris app list [--site <site>]` | Lista el catálogo con su versión y en qué sitios está instalada; con `--site`, añade las instancias de ese sitio. |
| `ferris app install <paquete\|wasm> [--name <app>]` | Valida e instala en `apps/<app>/`. |
| `ferris app enable <app>` | Añade la app a `[apps] enabled`. |
| `ferris app disable <app>` | La retira del conjunto publicado. |
| `ferris app remove <app> [--purge]` | Borra el paquete del catálogo. |

```bash
ferris build --app billing
ferris app install apps/billing        # el paquete que dejó el build
ferris app list
ferris app list --site acme
```

## Qué instala `install`

Un **paquete** es un directorio con `plugin.toml`, `<app>.wasm` y `world/`; es
exactamente lo que escribe `ferris build`. También se acepta un componente
`.wasm` suelto, que se envuelve en un paquete mínimo: el nombre sale de `--name`
o del *stem* del fichero, la versión es `0.1.0` y el `world/` se crea vacío. Si
necesitas versión y `[config]`, instala un paquete real.

Antes de publicar, el comando **instancia el componente** contra un host en
memoria. `is_component` solo comprueba la forma del binario; un componente
compilado contra un WIT de otra versión pasa esa comprobación y luego aborta el
arranque del sitio con un error de linker. Instanciarlo ahora mueve el fallo al
instante de instalar, antes de tocar el catálogo y de que ningún sitio copie un
paquete roto. El mensaje lo dice:

```text
`…/billing.wasm` is not compatible with this ferris binary; rebuild it against
`wit/ferris.wit` from the same release
```

La escritura en el catálogo copia solo ficheros regulares: un symlink dentro del
paquete no puede arrastrar un fichero de fuera. La copia a la instancia de un
sitio sí es atómica (fichero temporal y `rename` en el mismo directorio), así que
un corte a mitad no deja un componente incompleto. Reinstalar reemplaza la
**plantilla** del catálogo; las instancias de los sitios son copias y no se tocan.

## Listar

```text
global catalogue: /srv/bench/apps
  billing     0.1.0      sites: acme
  portal      1.2.0      not installed in any site
```

`app list --site <site>` añade la ruta de cada instancia del sitio, que es lo
que el guest monta en `/world`.

## Habilitar y deshabilitar

`[apps] enabled = []` significa **todas** las apps del directorio. Por eso
`disable` materializa primero los nombres de las demás: la lista resultante
describe exactamente lo que se publica desde ese momento. `enable` solo añade el
nombre; si la lista está vacía, la app ya estaba publicada y el comando lo dice.

Deshabilitar no borra nada. La app deja de cargarse y sus DocTypes, rutas y jobs
dejan de registrarse en el siguiente arranque.

## Retirar

`remove` borra `apps/<app>/` del catálogo. Se niega si algún sitio la tiene
instalada: primero hay que ejecutar `ferris site uninstall-app <app> --site
<site>` en cada uno, porque el sitio conserva su copia y sus datos.

`--purge` solo tiene sentido en una instancia de sitio; el catálogo guarda una
plantilla, no datos, y el comando lo indica en lugar de fingir que borró algo.

## Instalaciones con `[apps] wasm_dir` plano

Si `wasm_dir` **no** es el catálogo (`wasm_dir = "plugins"`, el layout
`--standalone`), `install`/`remove`/`list` mantienen el contrato antiguo de un
solo ámbito: copian `plugins/<app>.wasm`, crean `plugins/<app>/` y no hay
plantilla `world/` que un sitio pueda instalar. Es el comportamiento de un
proyecto autocontenido, no el de un bench.

## Lo que el comando no hace

- No descarga componentes de un registro: `install` recibe una ruta local.
- No instala en un sitio: eso es `ferris site install-app`, que copia y fija la
  versión.
- No ejecuta migraciones de datos de la app. `ferris migrate` aplica las
  customizaciones del mundo; los datos propios son responsabilidad de la app.
- No valida el `describe()` más allá de instanciar el componente; las rutas,
  capacidades y DocTypes se registran al arrancar el servidor.
