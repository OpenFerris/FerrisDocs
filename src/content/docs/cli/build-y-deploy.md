---
title: ferris build y ferris deploy
description: Compila el componente WASM en plugins/<app>.wasm, qué copia --out-dir y qué hace —y qué no hace— cada destino de despliegue.
---

`ferris build` produce el artefacto desplegable de una app: un componente WASM
en `plugins/<app>.wasm`. `ferris deploy` lo empaqueta o lo copia al destino que
elijas. Ninguno de los dos compila el servidor Ferris: la app es un invitado, y
el proceso que la hospeda es el binario `ferris` de la instalación.

## `ferris build`

```bash
ferris build [-p PROFILE] [-o OUT_DIR]
```

| Flag | Por defecto | Efecto |
|---|---|---|
| `-p`, `--profile <PROFILE>` | `release` | Perfil de cargo. `dev` escribe en `target/.../debug/`. |
| `-o`, `--out-dir <DIR>` | ninguno | Copia el artefacto y los assets del proyecto a ese directorio. |

El comando exige un proyecto (`Cargo.toml`) y ejecuta:

1. `cargo build --profile <profile>` en el directorio del proyecto. El target
   `wasm32-wasip2` lo pone `.cargo/config.toml` del scaffold.
2. Localiza el módulo compilado en
   `target/wasm32-wasip2/<carpeta>/<crate>.wasm`. La carpeta es `debug` para el
   perfil `dev` y el nombre del perfil en el resto de casos; el fichero usa el
   nombre del crate, así que `my-app` produce `my_app.wasm`.
3. Lo pasa por el pipeline de `ferris-wasm` para garantizar que es un
   **componente**, no un módulo básico.
4. Escribe `plugins/<package>.wasm`, esta vez con el nombre del paquete y sus
   guiones: el proyecto `my-app` deja `plugins/my-app.wasm`.

Con `--out-dir`, además del componente se copian los assets que existan:

```text
<out-dir>/
├── <package>.wasm
├── config/        # si el proyecto lo tiene
├── static/        # si existe
└── templates/     # si existe
```

No se copia `pkg/` (bundle de hidratación) ni `target/`. Un binario nativo solo
se copiaría si existiera, y un crate `cdylib` para `wasm32-wasip2` no lo genera:
el comando lo dice en vez de inventar un fichero.

```bash
# release, salida canónica en plugins/
ferris build

# perfil dev, a una carpeta de staging con config y static
ferris build --profile dev --out-dir /srv/staging/billing
```

:::note El nombre del plugin es la identidad
`plugins/<package>.wasm` se publica como app `<package>` (el *stem* con guiones).
Si renombras el paquete en `Cargo.toml`, el fichero y el nombre con el que el
servidor la carga cambian juntos.
:::

## `ferris deploy`

```bash
ferris deploy [-t TARGET] [-e ENV] [--skip-build] [--to DIR] [--registry REG]
```

| Flag | Por defecto | Efecto |
|---|---|---|
| `-t`, `--target` | `docker` | `docker`, `kubernetes`, `serverless` o `binary`. |
| `-e`, `--env <ENV>` | `production` | Etiqueta de imagen, namespace de k8s o nombre del directorio. |
| `--skip-build` | desactivado | No recompila; usa el `plugins/<app>.wasm` existente. |
| `--to <DIR>` | — | Directorio destino de `--target binary`. |
| `--registry <REG>` | — | Registro al que etiquetar y empujar la imagen. |

Salvo con `--skip-build`, primero ejecuta el equivalente a
`ferris build --profile release`.

### `--target docker`

- Exige un `Dockerfile` en el proyecto. El comando **no** lo genera: la imagen
  necesita el binario del servidor y el plugin, y el comando no puede inventar
  esa receta.
- **Sin** `--registry` no ejecuta `docker build`: informa de la etiqueta
  `ferris-app:<env>` y termina. Es el modo de “solo etiqueta local”.
- **Con** `--registry`, ejecuta `docker build -t ferris-app:<env> .`,
  `docker tag ferris-app:<env> <registry>/ferris-app:<env>` y
  `docker push <registry>/ferris-app:<env>`.

```bash
ferris deploy --target docker --env staging \
  --registry registry.example.com/team
```

### `--target kubernetes`

Comprueba el cliente con `kubectl version --client`, exige un directorio `k8s/`
con los manifiestos y aplica `kubectl apply -f k8s/ -n <env>`. No renderiza
plantillas ni crea el namespace: los manifiestos deben existir y ser válidos.

### `--target serverless`

No está implementado y falla a propósito:

```text
--target serverless is not implemented. `ferris deploy` knows how to build an
image with docker, apply k8s/ manifests, or copy the plugin to a directory; a
serverless deployment needs a provider and an adapter that do not exist yet.
```

### `--target binary`

Copia el plugin y la configuración a un directorio: `--to <DIR>` si se indica,
si no `/opt/ferris/<env>`.

- El plugin queda en `<dir>/apps/<app>.wasm` y `config/` se copia junto a él.
- `--env` es un nombre, no una ruta: debe ser un único segmento sin `/`, `\` ni
  `..`, porque se concatena a `/opt/ferris/`. Para una ruta real, usa `--to`.
- `/opt` requiere permisos de root; el error lo dice y sugiere `--to`.

```bash
ferris deploy --target binary --env staging --to /srv/billing
```

:::caution Se despliega el plugin, no la app en marcha
Al terminar, `deploy` lo recuerda: el plugin no es un programa. Hay que ejecutar
el servidor Ferris apuntando a ese directorio, con `plugins/` junto a la
configuración. `deploy` no copia el binario del servidor, no ejecuta migraciones
y no arranca nada.
:::

## Qué queda fuera

- Construir o versionar la imagen del **servidor** Ferris.
- Generar `Dockerfile`, manifiestos de Kubernetes o un adaptador serverless.
- Aplicar migraciones o customizaciones: eso es
  [`ferris migrate`](/cli/migrate/).
- Publicar el bundle de hidratación del Desk; el servidor sirve el suyo.

Para el despliegue completo, consulta
[despliegue](/operaciones/despliegue/).
