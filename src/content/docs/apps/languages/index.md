---
title: Lenguajes
description: Comparativa de toolchains para escribir una app WASM de Ferris, requisitos mínimos y cuándo elegir cada una.
---

El contrato es el mismo para todos: un componente del world `ferris-app`. Lo que
cambia es la herramienta que genera los bindings y empaqueta el `.wasm`.

## Comparativa

| Lenguaje | Toolchain | Requisito mínimo | Salida | Runtime embebido |
|---|---|---|---|---|
| Rust | `wit-bindgen` 0.62 + Cargo | Rust estable con target `wasm32-wasip2` | `target/wasm32-wasip2/…/<crate>.wasm` | no |
| Python | `componentize-py` | Python 3.10+ | `app.wasm` | sí (CPython) |
| JS/TS | `jco` + `componentize-js` | Node 22.12+ | `dist/<nombre>.wasm` | sí (SpiderMonkey) |
| Go | `componentize-go` | Go 1.27.1+ | `main.wasm` | sí (runtime de Go) |
| C/C++/C#/Zig | `wit-bindgen` + `wasm-tools` | toolchain wasm y adaptador WASI | el `.wasm` que nombres | no |

«Runtime embebido» significa que el componente lleva dentro el intérprete del
lenguaje. Un componente de JavaScript pesa varios MB antes de tu código; uno de
Rust o C puede ser una fracción de eso. Es un intercambio, no un defecto.

## Cuándo elegir cada una

### Rust

- cuando el tamaño y el arranque importan;
- cuando quieres tipos generados en compilación y cero runtime;
- cuando ya tienes un proyecto con `cargo` y `wasm32-wasip2`.

Es la opción con menos sorpresas en el límite: el compilador conoce el WIT y un
campo mal escrito no llega a ejecutarse.

### Python

- cuando el equipo ya escribe Python;
- cuando la lógica es datos, texto o reglas de negocio y el rendimiento no es el
  cuello de botella;
- cuando prefieres iterar rápido sobre un componente que arranca con un
  intérprete.

Limitación conocida: las importaciones de módulos deben resolverse en el **nivel
superior** del módulo; una importación perezosa dentro de una función puede no
encontrarse. Ver [Python](/apps/languages/python/).

### JavaScript y TypeScript

- cuando la UI de la app ya es JavaScript y quieres compartir tipos;
- cuando necesitas `fetch`, `URL`, `TextEncoder`, streams o criptografía del
  runtime;
- cuando el tamaño del componente no es crítico.

`jco scaffold` genera el proyecto completo desde el WIT, con declaraciones y
esqueleto. Ver [JavaScript](/apps/languages/javascript/).

### Go

- cuando el equipo escribe Go y quiere `go test` para la lógica;
- cuando necesitas concurrencia dentro del componente;
- cuando aceptas el peso del runtime.

`componentize-go` genera bindings, resuelve el módulo y produce el componente. Ver
[Go](/apps/languages/go/).

### C, C++, C#, Zig u otro

- cuando ya existe una base de código en ese lenguaje;
- cuando necesitas control fino de memoria;
- cuando tu toolchain produce componentes pero no está en esta lista.

El requisito no es el lenguaje: es el componente. Ver
[Otros lenguajes](/apps/languages/other/).

## Lo que no cambia

En todos los casos:

1. copias `wit/ferris.wit` y no lo editas;
2. generas bindings para el world `ferris-app`;
3. implementas `describe()` y los exports que uses;
4. produces un componente, no un módulo core;
5. validas con `wasm-tools validate` y `wasm-tools component wit`;
6. dejas el fichero en `plugins/<app>.wasm`.

## Cómo elegir por restricciones

| Restricción | Elección razonable |
|---|---|
| componente pequeño y arranque rápido | Rust, C, Zig |
| equipo sin experiencia en sistemas | Python, JS/TS |
| compartir tipos con el frontend | TypeScript |
| lógica con tests unitarios en el lenguaje | Go, Rust, Python |
| ya hay una librería en C/C++ | C/C++ con `wit-bindgen` |
| no quieres instalar un runtime extra | Rust o C |

:::tip[Prueba el contrato antes de elegir]
Un `describe()` mínimo y una ruta que responde `ok` bastan para validar el
toolchain de punta a punta. Hazlo antes de escribir la lógica: descubrir un
problema de empaquetado con mil líneas encima es más caro.
:::

## Páginas

- [Rust](/apps/languages/rust/)
- [Python](/apps/languages/python/)
- [JavaScript y TypeScript](/apps/languages/javascript/)
- [Go](/apps/languages/go/)
- [Otros lenguajes](/apps/languages/other/)
- [Construir el componente](/apps/building/) — la matriz de comandos completa.
