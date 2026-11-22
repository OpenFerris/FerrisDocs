---
title: Distribuir una app
description: "Empaquetado del componente y su mundo, versión, configuración [apps], secretos del operador, actualización atómica y rollback."
---

Distribuir una app son dos cosas: un componente `.wasm` y, si la app lo usa, su
**mundo**. El host no instala nada: lee un directorio al arrancar.

## El paquete

```text
plugins/
  mi-app.wasm            # el componente (obligatorio)
  mi-app/
    mi-app.wasm          # alternativa: el componente dentro del mundo
    customizations/      # personalizaciones exportadas
    data/                # datos propios
    files/               # blobs
    secrets/             # material secreto de la app
```

Se aceptan las dos disposiciones y la **plana gana** cuando existen las dos, para
que una copia vieja dentro del mundo nunca eclipse un build nuevo. El
descubrimiento es de un solo nivel: nada más profundo se escanea.

El nombre de la app es el nombre del fichero sin `.wasm`. Debe ser único y válido
(letras ASCII, dígitos, `-`, `_`; hasta 64 caracteres). Cambiar el nombre del
fichero cambia la app: sus URLs, su mundo y su configuración dejan de casar.

## Versión

Declara `plugin-version` en `describe()`:

```text
plugin-version: "1.4.2"
```

Aparece en `GET /plugins/<app>` y es lo que te dice qué binario está cargado
cuando algo no cuadra. Una actualización que olvida subirla convierte el
diagnóstico en una adivinanza.

No hay un campo de compatibilidad separado: la compatibilidad la impone el
`package` del WIT. Un componente compilado contra un paquete incompatible no
instancia; recompílalo con el `ferris.wit` del host.

## Configuración del host

```toml
[apps]
wasm_dir = "plugins"
enabled = []
```

- `wasm_dir` es el directorio; por defecto `./plugins`.
- `enabled` vacío significa «todas las que encuentre». Con nombres, es una lista
  de permitidos y un nombre sin fichero es un **error de arranque**.

Para TLS de la app, el host expone un puerto propio:

```toml
[apps]
plugin_tls_port = 8443
[apps.plugin_tls_ports]
mi-app = 8444
```

Un puerto no puede llevar dos certificados: dos apps con `tls-server` necesitan
entradas distintas.

## Customizations

Los cambios de campos y propiedades que la app quiere llevar consigo se exportan
a su mundo:

```http
POST /api/customization/Nota/export
Content-Type: application/json

{ "app": "mi-app" }
```

Quedan en `plugins/mi-app/customizations/Nota.json`. El host los aplica en
`ferris migrate` (con upsert), no al arrancar: una edición del Desk no exportada
no se revierte por reiniciar el proceso.

Al empaquetar, incluye `customizations/` si la app depende de ellos. Al
actualizar, vuelve a ejecutar `ferris migrate`.

## Secretos y configuración del operador

| Dónde | Quién lo controla | Qué va ahí |
|---|---|---|
| `platform::config-*` | la app | claves **no secretas** |
| `config` con `value-type: "secret"` | el operador | tokens, material TLS del host |
| `/world/secrets/` | la app | sus propios secretos |

Una clave declarada `secret` no se puede leer ni escribir desde el guest; el
operador la aprovisiona fuera de banda en el almacén de configuración de la app y
el guest nunca ve su valor.

:::danger[No metas secretos en el `.wasm`]
Un `pem(...)` inline viaja dentro del componente y, aunque el host lo redacte en
las proyecciones, cualquiera con el fichero lo tiene. Usa
`tls-material.secret("secrets/clave.pem")` y deja el PEM en el mundo, que rota
sin recompilar.
:::

Si el proyecto es el scaffold de Ferris, `ferris deploy` con `--target binary` y
`--to <dir>` copia la app y `config/`; en otros lenguajes, copia tú el
componente y el mundo. El resultado es el mismo.

## Actualización atómica

El host carga los componentes al arrancar. Para no dejar una app a medio
escribir:

```bash
cp mi-app.wasm plugins/.mi-app.wasm.new
mv plugins/.mi-app.wasm.new plugins/mi-app.wasm   # mismo directorio: rename atómico
```

- escribe el temporal **en el mismo directorio** (un `mv` entre sistemas de
  ficheros no es atómico);
- no borres el fichero anterior antes de tener el nuevo en su sitio;
- reinicia el host (o usa `ferris dev --hot-reload app` en desarrollo) para que
  el componente nuevo se instancie y se llame su `describe()`;
- comprueba `/plugins/<app>` y la versión antes de dar la actualización por buena.

En desarrollo, `ferris dev --hot-reload app` recompila el proyecto y sustituye la
instancia; re-registra DocTypes, eventos y métodos. Una **ruta nueva** sigue
necesitando reinicio, y un cambio de configuración del host también.

## Rollback

Guarda la versión anterior **fuera** de `plugins/` (o con otro nombre que no
termine en `.wasm`, para que el descubrimiento no la publique):

```text
releases/
  mi-app-1.4.1.wasm
  mi-app-1.4.2.wasm
```

Para volver:

```bash
cp releases/mi-app-1.4.1.wasm plugins/.mi-app.wasm.new
mv plugins/.mi-app.wasm.new plugins/mi-app.wasm
# reiniciar y comprobar /plugins/mi-app
```

El mundo (`plugins/mi-app/`) no se toca al revertir el componente. Si la versión
nueva migró datos propios en `data/`, revertir el binario no revierte esos datos:
por eso conviene versionar también el formato de lo que escribes ahí.

## Checklist de publicación

- [ ] el `.wasm` valida e importa `ferris:framework/*@0.3.0`;
- [ ] el nombre del fichero es el nombre definitivo de la app;
- [ ] `plugin-version` está actualizado;
- [ ] `enabled` incluye la app si el host usa lista de permitidos;
- [ ] el mundo existe con sus cuatro subcarpetas y los permisos correctos;
- [ ] `customizations/` está incluido si la app los necesita;
- [ ] los secretos están en `/world/secrets/` o en claves `secret` del operador,
      nunca en el binario;
- [ ] `/plugins/<app>` responde el descriptor esperado;
- [ ] las rutas declaradas están en `.routes` y no hay líneas de rechazo en el
      log;
- [ ] un usuario real (no solo un administrador) puede leer y escribir lo que la
      app promete;
- [ ] existe una versión anterior guardada para revertir.

## Qué no se distribuye

- `node_modules/`, `target/`, cachés de build y ficheros temporales;
- bases de datos locales (`test.db` y similares);
- claves privadas fuera de `secrets/` (y `secrets/` nunca se sirve por HTTP);
- una copia del mundo con datos de desarrollo si la app espera partir de cero.

La regla práctica: publica el componente, el esquema de configuración y lo que
la app necesita para arrancar; deja fuera todo lo que se regenera.
