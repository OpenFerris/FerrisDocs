---
title: Python
description: componentize-py desde el WIT hasta app.wasm, con bindings, un describe y un handler de ejemplo y la limitación de imports en tiempo de ejecución.
---

Python es la vía más rápida si el equipo ya escribe Python y la lógica no depende
del rendimiento. El componente lleva dentro un intérprete de CPython, así que
pesa más que uno de Rust; a cambio, no hay que aprender un lenguaje nuevo.

## Requisitos

- Python 3.10 o superior, con `pip`;
- `componentize-py`;
- `wasm-tools` para validar (recomendado).

```bash
pip install componentize-py
```

## Estructura

```text
mi-app/
  wit/
    ferris.wit
  mi_app.py          # tu implementación
  app.wasm           # salida
```

`-d wit` apunta al directorio que contiene `ferris.wit`; el world se selecciona
con `-w ferris-app`.

## Bindings

```bash
componentize-py -d wit -w ferris-app bindings mi_app_bindings
```

Genera un paquete `wit` con los tipos del contrato y las clases de exportación
dentro de `mi_app_bindings/`. Sirve para dos cosas: que el editor te autocomplete
y que puedas leer los nombres exactos de los tipos.

En el momento de `componentize`, `componentize-py` proporciona ese módulo `wit`
al código; por eso el módulo de la app puede hacer `import wit` sin copiar nada a
mano.

## Un `describe()` y un handler

```python
import json
import wit
from componentize_py_types import Ok, Err


@wit.guest
class App(wit.WorldExports):
    def describe(self):
        # Construye el Descriptor generado. Los campos son los del WIT:
        # capabilities, routes, auth-mode, doctypes, themes, folders,
        # workspaces, methods y las secciones opcionales.
        return Ok(self.descriptor())

    def doctype_event(self, event, doctype, name, data):
        if event == "validate" and doctype == "Nota":
            doc = json.loads(data)
            if not doc.get("titulo", "").strip():
                return Err(
                    wit.Error_ValidationFailed("el título es obligatorio")
                )
        return Ok(None)

    def handle_request(self, route_id, req):
        if route_id != "api":
            return Err(wit.Error_NotFound(route_id))
        return Ok(wit.Response(
            status=200,
            headers=[("content-type", "application/json")],
            body=b'{"ok": true}',
        ))
```

Los nombres de los constructores (`Error_ValidationFailed`, `Error_NotFound`) y
de los records salen del módulo generado. Si tu versión de `componentize-py` los
escribe distinto, el paquete de `bindings` es la referencia, no este ejemplo.

Un `result` se devuelve como `Ok(valor)` o `Err(variante)`. En `doctype_event` y
en los exports que devuelven `result<_, error>`, el éxito es `Ok(None)`.

## El descriptor

`describe()` devuelve el record `descriptor`. Las listas obligatorias
(`capabilities`, `routes`, `doctypes`, `themes`, `folders`, `workspaces`,
`methods`) deben ir siempre, aunque estén vacías; `auth-mode` también. Las
secciones opcionales se omiten o se pasan como `None`.

Un descriptor mínimo con un DocType y una ruta declara:

- `capabilities`: solo las específicas que necesites;
- `routes`: `id`, `method`, `path`, `kind`, `auth`, `body-limit`;
- `doctypes`: nombre, flags, `view`, `fields`, `indexes`;
- `plugin-version`.

La forma completa, con todos los campos, está en
[descriptor](/apps/descriptor/).

## Build

```bash
componentize-py -d wit -w ferris-app componentize --stub-wasi mi_app -o app.wasm
```

| Banda | Qué hace |
|---|---|
| `-d wit` | directorio del WIT |
| `-w ferris-app` | world a implementar |
| `--stub-wasi` | sustituye imports WASI no usados por stubs; evita el adaptador |
| `mi_app` | módulo de la app (el fichero `mi_app.py`) |
| `-o app.wasm` | componente de salida |

Sin `--stub-wasi`, el componente puede exigir un adaptador de WASI preview 2 en
el host; con él, el componente se basta para las importaciones que el host no
usa.

## Validación

```bash
wasm-tools validate app.wasm
wasm-tools component wit app.wasm | head -20
```

Deben aparecer los imports `ferris:framework/*@0.3.0` y los nueve exports.

## Limitaciones

- **Importaciones en tiempo de ejecución.** Los módulos deben resolverse en el
  **nivel superior** del fichero. Una importación dentro de una función puede no
  encontrarse:

  ```python
  # Puede fallar
  import paquete
  def f():
      return paquete.sub.foo()

  # Mejor
  from paquete import sub
  def f():
      return sub.foo()
  ```

- **Rendimiento.** El intérprete arranca con el componente. Para cargas altas,
  mide antes de optimizar; si el cuello es el intérprete, considera Rust o Go.
- **Tamaño.** El componente incluye CPython. No es un problema para el host, pero
  sí para distribuir por red.
- **Concurrencia.** No asumas hilos del sistema: diseña para llamadas cortas y
  encola el trabajo largo con `platform::enqueue-job`.

## Errores comunes

| Síntoma | Causa |
|---|---|
| `ModuleNotFoundError` al instanciar | import perezoso dentro de una función |
| el componente no valida | se generó un módulo core, no un componente |
| falta un export | la clase no implementa un método del world |
| `Err` inesperado en cada llamada | el descriptor devuelve una sección obligatoria vacía o mal tipada |
| el host responde 404 | el `.wasm` no está en `plugins/` o el nombre no coincide |

## Siguiente paso

- [Construir](/apps/building/) — la matriz completa de comandos.
- [Depuración](/apps/depuracion/) — logs y checklist.
