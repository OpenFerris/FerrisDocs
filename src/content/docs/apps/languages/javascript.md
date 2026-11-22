---
title: JavaScript y TypeScript
description: Proyecto con jco scaffold, build con componentize-js, estructura generada, ejemplos y cuándo el runtime embebido compensa.
---

JavaScript y TypeScript producen un componente con un motor de JavaScript dentro
(SpiderMonkey, vía `componentize-js`). Eso te da `fetch`, `URL`, streams,
`TextEncoder` y criptografía del runtime a cambio de varios MB de componente.

## Requisitos

- Node 22.12 o superior;
- `@bytecodealliance/jco` (incluye `componentize-js`);
- `wasm-tools` para validar (recomendado).

```bash
npm i -D @bytecodealliance/jco
```

## Scaffold

```bash
npx jco scaffold mi-app --wit wit/ferris.wit
cd mi-app
npm install
```

`--wit` acepta el fichero `ferris.wit` o el directorio que lo contiene. El
generador crea un proyecto completo:

```text
mi-app/
  package.json
  src/            # esqueleto de implementación
  wit/            # el contrato
  types/          # declaraciones generadas
  dist/           # el componente, tras el build
```

Los nombres y la estructura exactos pueden variar entre versiones de `jco`; el
`README.md` que genera el propio proyecto manda sobre esta lista.

## Implementación

El esqueleto ya trae las firmas de los nueve exports. Respétalas: el nombre de la
función y la forma del valor devuelto los fija el binding, no tu criterio.

```ts
export function describe() {
  return {
    capabilities: [],
    routes: [
      {
        id: "api",
        method: "*",
        path: "/notas",
        kind: "http",
        auth: { tag: "session" },
      },
    ],
    authMode: { tag: "session" },
    doctypes: [
      {
        name: "Nota",
        isSubmittable: false,
        isSingle: false,
        allowDelete: true,
        allowCopy: true,
        allowPrint: true,
        view: { tag: "form" },
        fields: ["titulo", "cuerpo"],
        indexes: [],
      },
    ],
    themes: [],
    folders: [],
    workspaces: [],
    methods: [],
    pluginVersion: "0.1.0",
  };
}
```

Los campos opcionales (`uiExtensions`, `dashboards`, `widgets`, `website`,
`assets`, `config`, …) se omiten o se pasan como `undefined`. Los obligatorios
deben estar aunque estén vacíos.

### Un handler

```ts
export function handleRequest(routeId: string, req: HttpRequest) {
  if (routeId !== "api") {
    return { status: 404, headers: [], body: new Uint8Array() };
  }
  return {
    status: 200,
    headers: [["content-type", "application/json"]],
    body: new TextEncoder().encode('{"ok":true}'),
  };
}
```

En el componente, `list<u8>` es un `Uint8Array`. `req.path` es lo que sigue al
prefijo y `req.query` llega sin `?`.

El binding representa un `result` como una unión etiquetada: el fallo se
devuelve con la rama `err` y el variante `error` correspondiente. La forma exacta
(ayudante o literal) la fija el módulo de tipos generado; consulta el esqueleto
antes de escribirla a mano.

### Un evento

```ts
export function doctypeEvent(event: string, doctype: string, name: string, data: string) {
  if (event === "validate" && doctype === "Nota") {
    const doc = JSON.parse(data);
    if (!String(doc.titulo ?? "").trim()) {
      // Para abortar con 422, devuelve aquí la rama `err` del `Result`
      // generado, con el variante `validation-failed` y el mensaje.
      // La forma exacta la fija el módulo de tipos del proyecto.
    }
  }
  return undefined; // éxito: `result<_, error>` sin valor
}
```

## Build

```bash
npm run build
```

El script del proyecto invoca `componentize-js` y deja el componente en `dist/`
(la ruta exacta la imprime el build). Alternativa directa, sin scaffold:

```bash
npx jco componentize src/app.js --wit wit -o app.wasm
```

Salida: un componente del world que declare el WIT, listo para `plugins/`.

## Node y navegador

- El **host** ejecuta el componente con su runtime; publica el `.wasm` tal cual.
- `jco transpile` convierte un componente en módulos ES para ejecutarlo en Node o
  el navegador. Eso es para **probar** tu app fuera del host, no para publicarla:
  el host no carga módulos JavaScript.
- El `fetch` del componente es el del runtime embebido; para salir a la red desde
  la app, el contrato ofrece `io::http-send`, que pasa por la política y los
  topes del host. No hay acceso directo a sockets.

## Tamaño y arranque

El motor embebido pesa varios MB. Si el componente se distribuye por red o
arranca muchas instancias, considera:

- mantener el código pequeño y evitar dependencias pesadas;
- usar `--aot` si tu toolchain lo soporta, para precompilar;
- medir el tiempo de instanciación antes de optimizar.

## Errores comunes

| Síntoma | Causa |
|---|---|
| `describe` no se encuentra | renombraste el export del esqueleto |
| el componente no valida | el build generó un módulo, no un componente |
| `TypeError` al devolver el descriptor | falta un campo obligatorio o un enum sin etiqueta |
| el host responde 404 | el `.wasm` no está en `plugins/` o el nombre no coincide |
| `fetch` falla | el host no permite el destino: usa `io::http-send` con política |
| el componente pesa demasiado | dependencia grande o build sin optimizar |

## Validación

```bash
wasm-tools validate dist/mi-app.wasm
wasm-tools component wit dist/mi-app.wasm | head -20
```

Deben aparecer los imports `ferris:framework/*@0.3.0` y los nueve exports.

## Siguiente paso

- [Construir](/apps/building/) — comandos y criterios de aceptación.
- [UI extensions](/apps/ui-extensions/) — si la app aporta widgets o páginas.
