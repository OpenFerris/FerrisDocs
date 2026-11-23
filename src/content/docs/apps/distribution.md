---
title: Distribuir una app
description: Empaquetado en el catálogo apps/, versión fijada por sitio, actualización con --force, rollback y qué no se distribuye.
---

Distribuir una app son dos cosas: un componente `.wasm` con su manifest y, si la
app lo usa, su **plantilla de mundo**. En un bench, `ferris build` produce el
paquete y `ferris site install-app` lo copia a cada sitio. El host no instala
nada desde un registro: lee el directorio que `[apps] wasm_dir` nombra.

## El paquete

```text
apps/mi-app/                 # catálogo global
├── mi-app.wasm              # el componente (obligatorio)
├── plugin.toml              # name + version + [config]
├── world/                   # PLANTILLA que se copia al sitio
│   ├── customizations/
│   ├── data/
│   ├── files/
│   └── secrets/
├── assets/                  # assets de UI
├── locales/                 # traducciones de la app (opcional)
│   ├── en.toml
│   └── es.toml
└── docperm.toml             # permisos de sus DocTypes (opcional)
```

`ferris build --app mi-app` escribe este paquete junto a las fuentes. Un
`.wasm` suelto también se acepta en `ferris app install`; se envuelve en un
paquete mínimo con versión `0.1.0` y un `world/` vacío.

`locales/<tag>.toml` lleva los mensajes de la app y `descriptor.locales` los
declara; ambos deben coincidir y `ferris app install` lo comprueba (tags, TOML,
claves y tamaño). `ferris site install-app` copia la carpeta al sitio y el
arranque la fusiona con los catálogos embebidos. Detalle en
[i18n y locales](/configuracion/i18n/).

El layout plano (`plugins/mi-app.wasm` + `plugins/mi-app/`) sigue siendo válido
para un `--standalone`: el fichero plano gana si existen los dos, para que una
copia vieja dentro del mundo nunca eclipse un build nuevo. El descubrimiento es
de un solo nivel.

El nombre de la app es el nombre del fichero sin `.wasm`. Debe ser único y válido
(letras ASCII, dígitos, `-`, `_`; hasta 64 caracteres). Cambiar el nombre del
paquete cambia la app: sus URLs, su mundo y su configuración dejan de casar.

## Versión

Hay dos números y no son lo mismo:

| Dónde | Qué es |
|---|---|
| `plugin.toml` → `version` | La versión del **paquete** en el catálogo. `ferris build` escribe `0.1.0` si el manifest no existe; edítalo al subir la versión. |
| `site_config.json` → `app_versions` | La versión que **ese sitio** instaló, capturada al copiar su componente. |
| `describe().plugin-version` | La versión que el componente declara en caliente; aparece en `GET /plugins/<app>`. |

Una actualización que olvida subir `plugin.toml` convierte el diagnóstico en una
adivinanza, y `site info` mostrará la versión antigua. No hay un campo de
compatibilidad separado: la compatibilidad la impone el `package` del WIT. Un
componente compilado contra un paquete incompatible no instancia; recompílalo con
el `ferris.wit` del host.

## La instancia es una copia

`ferris site install-app` copia el componente a
`sites/<site>/plugins/<app>/<app>.wasm` y registra la versión en
`site_config.json`. No es un symlink: el sitio fija lo que instaló.

- Reemplazar `apps/<app>/<app>.wasm` con un build nuevo **no** cambia lo que
  sirve un sitio ya instalado.
- `ferris site install-app <app> --site <site> --force` es la única operación
  que copia la versión nueva y actualiza `app_versions`.
- En una actualización, `secrets/` no se copia, `data/` y `files/` no se tocan y
  `config.toml` se fusiona. `customizations/` sí se reemplaza porque es la salida
  de la plantilla.

Antes de publicar, tanto `ferris app install` como `ferris site install-app`
**instancian** el componente contra el host en memoria. Un `.wasm` incompatible
con este binario falla en el comando, antes de tocar el catálogo o el sitio:

```text
`…/mi-app.wasm` is not compatible with this ferris binary; rebuild it against
`wit/ferris.wit` from the same release
```

## Configuración del host

```toml
[apps]
wasm_dir = "apps"
enabled = []
```

- `wasm_dir` es el directorio; en el bench, `apps/`; en un `--standalone`,
  `plugins/`.
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
entradas distintas. El detalle está en [Apps](/configuracion/apps/).

## Customizations

Los cambios de campos y propiedades que la app quiere llevar consigo se exportan
a su mundo:

```http
POST /api/customization/Nota/export
Content-Type: application/json

{ "app": "mi-app" }
```

Quedan en `<mundo>/customizations/Nota.json`; en un bench,
`apps/mi-app/customizations/Nota.json`. `ferris build` los copia a
`apps/mi-app/world/customizations/`, de modo que viajan en el paquete. El host
los aplica en `ferris migrate` (con upsert), no al arrancar.

Al actualizar una app en un sitio, vuelve a ejecutar `ferris site migrate
<site>`: aplica las customizaciones de las instancias de ese sitio.

## Permisos (`docperm.toml`)

El descriptor de una app declara DocTypes, pero no reglas de acceso. Para que
los permisos viajen con el paquete, pon un `docperm.toml` junto a
`plugin.toml`:

```toml
[[permissions]]
doctype = "Task"
role = "System Manager"
read = true
write = true
create = true
delete = true

[[permissions]]
doctype = "Task"
role = "All"       # todos los visitantes, incluidos los anónimos
read = true
```

Los derechos que no nombres valen `false`; `All` es el rol especial que el
motor traduce a «todo el mundo». `ferris site install-app` aplica el fichero a
la **base de datos de ese sitio** con upsert, así que reinstalar es idempotente
y quitar una entrada del fichero no revoca el permiso ya concedido: revocar es
una acción explícita del operador (`ferris role-permissions delete`).
`ferris build` deja el fichero en el paquete y `ferris app install` también lo
copia al catálogo.

## Secretos y configuración del operador

| Dónde | Quién lo controla | Qué va ahí |
|---|---|---|
| `platform::config-*` | la app | claves **no secretas** |
| `config` con `value-type: "secret"` | el operador | tokens, material TLS del host |
| `/world/secrets/` | la app | sus propios secretos |

Una clave declarada `secret` no se puede leer ni escribir desde el guest; el
operador la aprovisiona fuera de banda y el guest nunca ve su valor.

:::danger[No metas secretos en el `.wasm`]
Un `pem(...)` inline viaja dentro del componente y, aunque el host lo redacte en
las proyecciones, cualquiera con el fichero lo tiene. Usa
`tls-material.secret("secrets/clave.pem")` y deja el PEM en el mundo, que rota
sin recompilar.
:::

## Actualización y rollback

El orden que no deja un sitio a medias:

```bash
# 1. construye la versión nueva en el catálogo
ferris build --app mi-app

# 2. actualiza cada sitio que la tenga
ferris site install-app mi-app --site acme --force
ferris site migrate acme

# 3. comprueba la versión servida
ferris site info acme            # versions: mi-app=<versión>
curl -s localhost:8000/plugins/mi-app | jq '.plugin_version'
```

Guardar la versión anterior **fuera** del catálogo evita que el descubrimiento la
publique por accidente. Un directorio `releases/` con paquetes completos es
suficiente:

```text
releases/
  mi-app-1.4.1/
  mi-app-1.4.2/
```

Para volver:

```bash
ferris app install releases/mi-app-1.4.1
ferris site install-app mi-app --site acme --force
# reiniciar y comprobar la versión
```

El mundo del sitio (`sites/<site>/plugins/mi-app/`) no se toca al revertir el
componente. Si la versión nueva migró datos propios en `data/`, revertir el
binario no revierte esos datos: versiona también el formato de lo que escribes
ahí.

`ferris app remove <app>` se niega mientras algún sitio la tenga instalada:
primero `ferris site uninstall-app <app> --site <site>` en cada uno.

## Checklist de publicación

- [ ] el `.wasm` valida e importa el `ferris:framework` del host;
- [ ] el nombre del paquete es el nombre definitivo de la app;
- [ ] `plugin.toml` tiene la versión nueva;
- [ ] el paquete incluye `world/` y `assets/` cuando la app los usa;
- [ ] `enabled` incluye la app si el host usa lista de permitidos;
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

La regla práctica: publica el componente, el manifest, la plantilla del mundo y
lo que la app necesita para arrancar; deja fuera todo lo que se regenera.
