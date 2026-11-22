---
title: ferris app
description: Instalar, listar, habilitar y retirar apps WASM en un proyecto, sin un registro ni una tabla de aprobación.
---

`ferris app` gestiona los componentes que el servidor publica en `plugins/`.
No hay un instalador con base de datos ni un manifiesto aparte: el componente
`.wasm` es la app, su `describe()` es el manifiesto y `[apps] enabled` es el
único interruptor.

El comando necesita la feature `wasm`, que está en el conjunto por defecto. En
una compilación mínima (`--no-default-features --features api`) no existe.

## Subcomandos

| Comando | Efecto |
|---|---|
| `ferris app list` | Lista cada componente, si está habilitado, su tamaño y su ruta. |
| `ferris app install <fichero> [--name <app>]` | Valida el componente, lo copia como `plugins/<app>.wasm`, crea el mundo y lo habilita. |
| `ferris app enable <app>` | Añade la app a `[apps] enabled`. |
| `ferris app disable <app>` | La retira del conjunto publicado. |
| `ferris app remove <app> [--purge]` | Borra el componente; conserva el mundo salvo que se pase `--purge`. |

```bash
ferris app install target/wasm32-wasip2/release/facturacion.wasm
ferris app list
ferris app disable facturacion
ferris app remove facturacion --purge
```

## Instalación

`install` comprueba que el fichero sea un **componente** WebAssembly (no un
módulo suelto) antes de publicarlo. El nombre sale de `--name` o del stem del
fichero, y debe ser un identificador de crate: letras ASCII, dígitos, `-` y `_`,
hasta 64 caracteres.

La escritura es atómica: primero se copia a `.<app>.wasm.tmp` y luego se renombra,
así que un corte a mitad de copia no deja un componente incompleto que el
siguiente arranque intente compilar. El mundo (`plugins/<app>/` con
`customizations/`, `data/`, `files/` y `secrets/`) se crea en el mismo paso.

Si `[apps] enabled` no está vacío y no contiene la app, `install` la añade. Si la
lista está vacía, la app queda publicada sin tocar la configuración: vacío
significa "todas".

## Habilitar y deshabilitar

`[apps] enabled = []` significa **todas** las apps del directorio. Por eso
`disable` materializa primero los nombres de las demás: la lista resultante
describe exactamente lo que se publica desde ese momento. `enable` solo añade el
nombre; si la lista está vacía, la app ya estaba publicada y el comando lo dice.

Deshabilitar no borra nada del mundo. La app deja de cargarse y sus DocTypes,
rutas y jobs dejan de registrarse en el siguiente arranque.

## Retirar

`remove` borra `plugins/<app>.wasm` y `plugins/<app>/<app>.wasm`. El mundo se
conserva para que los datos de la app no desaparezcan por accidente; `--purge`
lo elimina entero, incluidos `data/`, `files/` y `secrets/`.

## Lo que el comando no hace

- No descarga componentes de un registro: `install` recibe una ruta local.
- No ejecuta migraciones de datos de la app. `ferris migrate` aplica las
  customizaciones del mundo; los datos propios son responsabilidad de la app.
- No valida el `describe()` del guest. Para eso hay que instanciarlo, y eso
  ocurre en el arranque del servidor con la base y los servicios disponibles.
