---
title: Otros lenguajes
description: "C, C++, C#, Zig y cualquier toolchain propia: qué debe producir el componente, cómo adaptar WASI y cómo validarlo antes de publicarlo."
---

El contrato no exige un lenguaje. Exige un **componente** del world
`ferris:framework@0.3.0` / `ferris-app`. Si tu toolchain produce uno, sirve.

## La regla única

El resultado debe:

- exportar las funciones del world `ferris-app`, con sus nombres y firmas;
- importar `ferris:framework/*` y, si hace falta, WASI preview 2;
- no importar nada que el host no ofrezca (SQL, sockets propietarios, APIs de
  sistema del host);
- ser un componente, no un módulo core.

## C y C++

El camino estándar es `wit-bindgen` para C, un compilador a wasm y
`wasm-tools` para cerrar el componente.

```bash
wit-bindgen c wit --world ferris-app --out-dir bindings
```

Genera cabeceras y un fichero de pegamento que implementa la traducción entre el
componente y tu código. Tu implementación rellena las funciones exportadas y usa
las importadas para llamar a `data`, `io` o `platform`.

Compila con un SDK de WASI:

```bash
clang --target=wasm32-wasi -O2 -I bindings \
  -o core.wasm src/*.c bindings/*.c
```

Después conviértelo en componente:

```bash
wasm-tools component new core.wasm -o mi-app.wasm \
  --adapt wasi_snapshot_preview1=<ruta-al-adaptador>
```

- `--adapt wasi_snapshot_preview1=…reactor.wasm` traduce las importaciones de
  WASI preview 1 al world de preview 2. Úsalo si tu módulo importa
  `wasi_snapshot_preview1`.
- Si tu toolchain ya emite un componente, **no** lo vuelvas a envolver.
- `wasm-tools component wit mi-app.wasm` te dice si el resultado es el world
  correcto.

En C++ puedes usar `wit-bindgen c` con un `extern "C"` o generar bindings C++ si
tu versión los ofrece; el límite sigue siendo el mismo componente.

## C#

`componentize-dotnet` envuelve `wit-bindgen` y `wasm-tools` en un paquete NuGet:

```bash
dotnet new install BytecodeAlliance.Componentize.DotNet.Templates
dotnet new componentize.wasi.lib -o mi-app
```

Declara el WIT y el world en el `.csproj`:

```xml
<ItemGroup>
  <Wit Update="wit/ferris.wit" World="ferris-app" />
</ItemGroup>
```

```bash
dotnet build
```

El paquete genera las clases de import/export y produce el componente. La ruta
del `.wasm` la imprime el build y cambia con la versión del SDK; compruébala con
`wasm-tools component wit`.

:::note[Los nombres del binding mandan]
En C# el espacio de nombres y el nombre de la clase de implementación los fija el
generador a partir del WIT. Si el compilador dice que falta `XxxImpl`, el
generador te está diciendo exactamente cómo debe llamarse.
:::

## Zig

Zig puede compilar a `wasm32-wasi`. El flujo es el mismo que en C:

1. genera bindings C con `wit-bindgen c`;
2. compila tu código y el pegamento a un módulo core;
3. envuélvelo con `wasm-tools component new` y el adaptador.

```bash
zig build-lib -target wasm32-wasi -O ReleaseSmall src/main.zig
```

Si tu versión de Zig emite componentes directamente, sáltate el paso 3 y valida
el resultado.

## Traer tu propio toolchain

Cualquier generador sirve si cumple estos puntos:

| Requisito | Cómo comprobarlo |
|---|---|
| contrato correcto | `wasm-tools component wit app.wasm` |
| exports completos | la salida anterior lista los nueve |
| imports permitidos | solo `ferris:framework/*` y WASI |
| componente válido | `wasm-tools validate app.wasm` |
| memoria suficiente | el componente arranca y responde a `describe` |

Si tu herramienta produce un módulo core con `wasi_snapshot_preview1`, necesitas
un adaptador. Si produce un componente de otro world, necesitas regenerar los
bindings con `ferris.wit`; no hay forma de “renombrar” un world a posteriori.

## WASI: lo que puedes y no puedes usar

El host concede un subconjunto de WASI y monta el mundo de la app:

- **sistema de ficheros**: solo `/world`, con lectura y escritura. `..`, rutas
  absolutas que salgan de la raíz y un root simbólico se rechazan;
- **relojes y aleatoriedad**: disponibles;
- **entorno y argumentos**: no son una vía de configuración; usa
  `platform::config-*`;
- **sockets**: no. La red sale por `io::http-send` o `io::connect-stream`, con la
  política del host;
- **hilos del sistema**: no cuentes con ellos; diseña llamadas cortas.

## Validación

```bash
wasm-tools validate mi-app.wasm
wasm-tools component wit mi-app.wasm
```

Criterios de aceptación:

- [ ] el componente importa `ferris:framework/*@0.3.0` y exporta las funciones
      del world `ferris-app`;
- [ ] los nueve exports existen;
- [ ] no hay imports fuera del contrato y WASI;
- [ ] el componente no lee rutas del host distintas de `/world`;
- [ ] `describe()` responde sin error al cargarlo;
- [ ] el fichero se llama como la app.

## Errores comunes

| Síntoma | Causa |
|---|---|
| `component imports instance … not found` | falta el adaptador o el host no ofrece esa interfaz |
| `no export of name 'describe'` | los bindings se generaron para otro world |
| el componente valida pero no instancia | import de una interfaz que el host no implementa |
| el host responde 404 | el `.wasm` no está en `plugins/` o el nombre no coincide |
| el guest no ve ficheros | estás usando una ruta fuera de `/world` |
| el componente agota el plazo | trabajo largo en una llamada; usa `platform::enqueue-job` |

## Cuándo este camino tiene sentido

- ya existe una base de código en C/C++/C#/Zig y reescribirla no es una opción;
- necesitas control de memoria o un binario mínimo;
- tu plataforma tiene un compilador a wasm pero no un toolchain específico para
  componentes.

En el resto de casos, las páginas de [Rust](/apps/languages/rust/),
[Python](/apps/languages/python/), [JavaScript](/apps/languages/javascript/) y
[Go](/apps/languages/go/) ahorran el trabajo de atar bindings, compilador y
adaptador a mano.
