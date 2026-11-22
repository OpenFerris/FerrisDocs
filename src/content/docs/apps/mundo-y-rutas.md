---
title: Mundo, rutas y métodos
description: El directorio plugins/<app>/ montado en /world, los espacios de URL de la app, la autorización por ruta y la cadena de métodos heredables.
---

Una app no es solo un `.wasm`. Tiene un **mundo** en disco y dos espacios de URL
propios, además de las rutas que declare y los métodos que publique.

## El mundo en disco

```text
plugins/mi-app/
  customizations/   Custom Field y Property Setter exportados
  data/             datos propios de la app
  files/            blobs que adjunta
  secrets/          material secreto (nunca se sirve)
  mi-app.wasm       opcional: el componente dentro de su mundo
```

El host crea las cuatro subcarpetas al publicar la app. El nombre se valida antes
de convertirse en un componente de ruta: letras ASCII, dígitos, `-` y `_`, hasta
64 caracteres. Un punto, una barra o un espacio se **rechazan**, no se sanean:
sanear haría colisionar dos apps.

## `/world` es todo el sistema de ficheros del guest

```text
write("/world/data/estado.json", bytes)
leer("/world/secrets/.env")
```

Son rutas **absolutas**: WASI preview 2 no tiene un directorio de trabajo de
proceso. El montaje es un preopen del runtime, no una comprobación que se pueda
saltar:

- `..` y cualquier ruta que salga de la raíz se rechazan;
- un root del mundo que sea un enlace simbólico se rechaza;
- el montaje es por instancia: una app nunca ve el mundo de otra;
- el mundo es de lectura y escritura, y es tuyo: no hay API de blobs, ficheros o
  secretos en el guest, escribes tu propio directorio.

:::danger[No guardes aquí lo que no es tuyo]
El mundo no es el servicio de ficheros del host. Los adjuntos y descargas del
Desk (`/api/files`, backends S3/Azure/GCS) son otra cosa. En `/world` van los
datos, ficheros y secretos **de la app**.
:::

## Customizations: exportar e importar

El editor de campos del Desk guarda los cambios de personalización en la base de
datos. Para que viajen con la app, se exportan a su mundo:

```http
POST /api/customization/Nota/export
Content-Type: application/json

{ "app": "mi-app" }
```

Escribe `plugins/mi-app/customizations/Nota.json` con esta forma:

```json
{
  "doctype": "Nota",
  "fields": [
    { "fieldname": "prioridad", "fieldtype": "Int", "insert_after": "titulo" }
  ],
  "properties": [
    { "fieldname": "titulo", "property": "label", "value": "Asunto" }
  ]
}
```

El `doctype` va dentro del fichero porque el nombre del fichero está saneado y no
se puede revertir. Un `scope` opcional restringe la exportación a los cambios que
acabas de hacer: un export con scope es un diff revisable.

La importación ocurre en **`ferris migrate`**, no al arrancar:

```bash
ferris migrate
```

Aplica cada `customizations/*.json` de cada mundo habilitado, con upsert: correrlo
dos veces no cambia nada. Es deliberado: una edición hecha en el Desk y no
exportada no debe revertirse porque el proceso se reinició.

## Los espacios de URL de la app

La app posee estos prefijos. El host resuelve la app, aplica la política y te
pasa el resto de la ruta con un identificador estable:

| Prefijo | `route-id` | Auth del host |
|---|---|---|
| `/plugins/<app>/*` | `plugins` | ninguna impuesta; la app decide |
| `/api/plugins/<app>/*` | el `id` de la ruta declarada que case, o `api` | la de esa ruta; sin coincidencia, sesión (y CSRF en mutaciones) |
| `/desk/<app>/*` | `page` | sesión de Desk (redirige a login) |
| `/api/method/<name>` | `method:<name>` | sesión del llamante |

`/plugins/<app>/*` es la entrada directa: el `path` que recibes es lo que sigue al
nombre de la app (`/` para el prefijo mismo). Es útil para endpoints públicos,
webhooks y para probar con `curl`.

`/api/plugins/<app>/*` es tu API JSON: no hereda los permisos de
`/api/resource`, pero sí la sesión por defecto. La política sale de tus rutas
declaradas: una ruta con `auth: none` cuyo `path` case hace público ese endpoint;
sin coincidencia, el host exige sesión. `/desk/<app>/*` es para páginas y siempre
exige sesión antes de despachar. Un nombre que ya es un DocType o un módulo del
Desk no se registra como namespace de página; el motivo queda en el log.

### Rutas declaradas

Además de esos espacios, `descriptor.routes` declara endpoints con `path`,
`method`, `kind`, `auth` y `body-limit`. El host los monta en la **raíz** del
router, en el `path` declarado, y compara segmento a segmento: gana la
coincidencia más larga. No interpreta placeholders; tú analizas el `path`
restante.

Se rechazan, con log y sin montar:

- un primer segmento del framework: `api`, `desk`, `plugins`, `static`, `files`,
  `events`, `socket.io`, `pkg`, `health`, `login`, `logout`, `assets`,
  `favicon.ico`;
- `path = "/"`, que reclamaría todo el namespace;
- una ruta duplicada (mismo método y patrón) de la misma app u otra;
- un `path` que no es un prefijo de URL montable;
- una ruta `%stream` sin `listener`.

:::caution[Una ruta nueva exige reinicio]
La tabla se construye al arrancar. Una recarga en caliente reemplaza handlers,
capacidades y auth, pero **no** monta una ruta nueva. Hasta reiniciar, esa ruta
responde el 404 de siempre.
:::

### Auth por ruta

```wit
variant route-auth {
    none,
    session,
    capability(string),
}
```

La variante `capability` es para máquinas: el llamante envía
`x-ferris-capability: <token>` y el host lo compara en tiempo constante contra la
clave secreta `route.<name>.token` de la app. `401` si falta o no coincide, `403`
si la app nunca provisionó la clave. La cabecera **no** se reenvía al guest.
`none` despacha como invitado anónimo, aunque el llamante traiga sesión.

## Métodos heredables

Un método con `overrides = true` no crea nada: sustituye el handler del mismo
nombre. El host mantiene una cadena ordenada: la base del host, luego las apps.
La llamada normal alcanza la última entrada.

```wit
methods: [{
    name: "files.list",
    params: [("path", "string")],
    returns: "array",
    description: "Selector propio",
    overrides: true,
}],
```

Hay **una entrada por app**: una recarga reemplaza la suya, no apila otra. Un
`overrides` sin base debajo no se registra, y el error queda en el log.

### `data::call-method` es el `super`

```text
resultado = data::call-method("files.list", params_json)
```

Ejecuta el handler inmediatamente por debajo del tuyo. Reglas:

- el ámbito es el **llamante**: un método que la app no sobrescribe responde
  `permission-denied`;
- es imposible reentrar en la propia entrada (no hay recursión accidental);
- **no hay fallback automático**: si el handler de arriba falla, la llamada
  falla. Caer al de abajo convertiría una app rota en una API distinta sin avisar.

## Comprobarlo en caliente

```bash
# descriptor proyectado: capacidades, rutas, métodos y DocTypes
curl -s localhost:8000/plugins/mi-app | jq '.routes, .methods'

# el mundo, desde fuera
ls -la plugins/mi-app/{customizations,data,files,secrets}
```

`/plugins/<app>` **proyecta** el descriptor; no reenvía lo que dijo el guest. Si
algo no aparece ahí, no está declarado. Redacta el material TLS inline y no
incluye valores de configuración.
