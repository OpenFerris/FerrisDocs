---
title: Go
description: componentize-go, generación de bindings, go mod tidy, build a main.wasm y la forma de un describe y un handler.
---

Go produce un componente con el runtime del lenguaje dentro. Es una buena opción
si el equipo ya escribe Go, si quieres `go test` para la lógica y si el tamaño
del componente no es crítico.

## Requisitos

- Go 1.27.1 o superior;
- `componentize-go`;
- `wasm-tools` para validar (recomendado).

```bash
go install github.com/bytecodealliance/componentize-go@latest
```

También puedes declararlo como herramienta del módulo:

```text
tool github.com/bytecodealliance/componentize-go
```

y usar `go tool componentize-go`.

## Estructura

```text
mi-app/
  go.mod
  wit/
    ferris.wit
  main.go            # tu implementación
  main.wasm          # salida del build
```

## Bindings

```bash
componentize-go --world ferris-app bindings --format
```

Genera los paquetes de bindings para el world: tipos del contrato, imports y los
hooks de exportación. `--format` pasa `gofmt` al resultado, así que el código
generado se lee y se versiona como el tuyo.

```bash
go mod tidy
```

Resuelve las dependencias que los paquetes generados declaran. Sin este paso el
build falla con módulos que faltan, no con un error del contrato.

## Implementación

El world tiene nueve exports. El paquete generado define dónde se registra cada
uno; el esqueleto que produce `bindings` es la referencia para los nombres
exactos de tipos y campos.

```go
package main

// Forma del descriptor: los campos son los del WIT.
// Las listas obligatorias van siempre, aunque estén vacías.
func describe() (Descriptor, error) {
    return Descriptor{
        Capabilities: []Capability{},
        Routes: []Route{{
            ID:     "api",
            Method: "*",
            Path:   "/notas",
            Kind:   RouteKindHTTP,
            Auth:   RouteAuthSession,
        }},
        AuthMode: RouteAuthSession,
        Doctypes: []Doctype{{
            Name:         "Nota",
            AllowDelete:  true,
            AllowCopy:    true,
            AllowPrint:   true,
            Fields:       []Field{BareName("titulo"), BareName("cuerpo")},
            Indexes:      []Index{},
        }},
        Themes:        []Theme{},
        Folders:       []Folder{},
        Workspaces:    []Workspace{},
        Methods:       []Method{},
        PluginVersion: "0.1.0",
    }, nil
}

func handleRequest(routeID string, req HTTPRequest) (Response, error) {
    if routeID != "api" {
        return Response{Status: 404}, nil
    }
    return Response{
        Status:  200,
        Headers: [][2]string{{"content-type", "application/json"}},
        Body:    []byte(`{"ok":true}`),
    }, nil
}
```

Los identificadores (`Descriptor`, `RouteKindHTTP`, `BareName`, …) son
representativos: el paquete generado puede añadir prefijos o usar constructores.
No los escribas de memoria; abre el código de `bindings` y copia sus nombres.

### Un evento

```go
func doctypeEvent(event, doctype, name, data string) error {
    if event == "validate" && doctype == "Nota" {
        var doc map[string]any
        if err := json.Unmarshal([]byte(data), &doc); err != nil {
            // Devuelve aquí el error tipado del binding para un JSON inválido.
            return err
        }
        if titulo, _ := doc["titulo"].(string); strings.TrimSpace(titulo) == "" {
            // Devuelve aquí el variante `validation-failed`: 422 y la fila
            // no se escribe. El tipo concreto lo define el paquete generado.
            return err
        }
    }
    return nil
}
```

La forma de devolver un variante `error` la fija el binding (un tipo de error
generado). En un punto `before-*` el error aborta; en el resto, el documento ya
está persistido. Los `return err` del ejemplo son marcadores: sustitúyelos por el
valor tipado que genere `bindings`.

## Build

```bash
componentize-go --world ferris-app build
```

Salida: `main.wasm`. Si el world está declarado en un `componentize-go.toml`,
puedes omitir `--world`; si pasas `--world`, ese valor manda y se ignoran los
worlds del fichero.

El build compila el módulo Go y lo convierte en componente. No hace falta un
`wasm-tools component new` manual.

## Validación

```bash
wasm-tools validate main.wasm
wasm-tools component wit main.wasm | head -20
```

Deben aparecer los imports `ferris:framework/*@0.3.0` y los nueve exports.

## Notas

- **`go vet` sobre el código generado.** Los bindings usan `unsafe.Pointer` y
  representan tuplas de una forma que el análisis por defecto rechaza. Si
  necesitas pasar `go vet`, excluye esos casos
  (`go vet -unsafeptr=false -composites=false ./...`) o limita el análisis a tus
  paquetes.
- **Tamaño.** El componente incluye el runtime de Go. Un binario de unos pocos MB
  es normal; mide antes de optimizar.
- **Concurrencia.** Puedes usar goroutines dentro del componente, pero las
  llamadas del host son síncronas y tienen un presupuesto de CPU: no dejes trabajo
  indefinido en segundo plano. Encola jobs con `platform::enqueue-job`.
- **`go mod tidy` no es opcional.** El primer build tras `bindings` falla si no
  se resolvieron las dependencias generadas.

## Errores comunes

| Síntoma | Causa |
|---|---|
| `missing go.sum entry` | falta `go mod tidy` tras `bindings` |
| falta un export | el paquete de exports no se registró en `init`/`main` |
| el componente no valida | se compiló un binario, no un componente |
| el host responde 404 | el `.wasm` no está en `plugins/` o el nombre no coincide |
| `permission-denied` | capacidad específica sin declarar en `describe()` |

## Siguiente paso

- [Construir](/apps/building/) — la matriz de comandos.
- [Depuración](/apps/depuracion/) — qué mirar cuando no carga.
