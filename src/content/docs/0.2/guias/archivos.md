---
title: Archivos
description: El servicio de ficheros del Desk, los backends soportados, las
  subidas por bytes y la diferencia con el mundo de una app.
slug: 0.2/guias/archivos
---

Ferris tiene **dos** almacenes de ficheros, y confundirlos es el error más común:

| Almacén | Dueño | Para qué |
|---|---|---|
| servicio de ficheros | el framework | adjuntos, imágenes de campo, el selector del Desk |
| mundo de la app | la app | todo lo que la app produce y necesita leer |

El servicio de ficheros tiene API HTTP, ACL por fichero y URLs firmadas. El mundo
es un directorio (`plugins/<app>/`) que solo ve su app, montado en `/world`.

:::caution[La app escribe en su mundo, no en el host]
La app no pide al host que guarde un blob: escribe en `/world/files/`. Si necesita
que un humano lo descargue desde el Desk, o lo adjunta a un documento, o lo sube
al servicio de ficheros. Son caminos distintos.
:::

## Configuración

```toml
[features]
files = true

[files]
backend = "local"
local_path = "./files"
cdn_url = "https://cdn.example.com"
max_file_size_mb = 50
allowed_extensions = ["pdf", "png", "jpg", "csv"]
image_optimization = true
image_quality = 85
```

| Backend | Cuándo |
|---|---|
| `local` | un volumen del host; el más simple |
| `s3` | S3 o compatible (MinIO, R2) |
| `azure` | Azure Blob Storage |
| `gcs` | Google Cloud Storage |
| `memory` | tests; no persiste |

`allowed_extensions` vacío significa **todas**. El store vuelve a validar el
tamaño real y, en imágenes declaradas, los **magic bytes**: no se fía del
`content-type` ni de la extensión que envía el cliente.

:::danger[Sin `files`, no hay rutas]
Un binario sin el vertical `files` no monta `/api/files`, y el Desk muestra el
selector como disponible en lugar de fallar en silencio. El flag de runtime
`[features] files = false` desmonta además la ruta de descargas firmadas `/files`.
:::

## Subir

`POST /api/files` recibe los **bytes crudos**, no multipart: el navegador manda un
`Blob`/`ArrayBuffer` y el servidor se ahorra un parser que confiar.

```bash
curl -X POST localhost:8000/api/files \
  -b cookies.txt \
  -H "x-file-name: informe.pdf" \
  -H "content-type: application/pdf" \
  --data-binary @informe.pdf
```

| Cabecera | Uso |
|---|---|
| `x-file-name` | nombre visible (se percent-decode) |
| `content-type` | tipo declarado; el store lo revalida |

La subida exige sesión. El `AccessContext` del store registra el propietario y
aplica después la ACL por fichero: tener sesión no implica poder leer cualquier
fichero.

## Listar y descargar

```http
GET /api/files?search=informe&limit=100
GET /api/files/{id}
DELETE /api/files/{id}
```

`GET /api/files` es un **adaptador fino** sobre el método `files.list` de la
cadena de métodos. Por eso una app que sobrescribe `files.list` cambia lo que el
selector del Desk muestra —por ejemplo, un Drive propio— sin tocar el frontend:

```rust
methods: vec![descriptor::Method {
    name: "files.list".to_string(),
    params: vec![("search".to_string(), "string".to_string())],
    returns: "array".to_string(),
    description: "Drive de la app".to_string(),
    overrides: true,
}],
```

Necesita la capacidad `overrides`. Ver
[mundo, rutas y métodos](/0.2/apps/mundo-y-rutas/).

## URLs firmadas

Para servir un fichero sin sesión (un `<img>` en un correo, un enlace temporal),
el servicio emite URLs firmadas bajo `/files`:

```text
/files/<id>?expires=<unix-seconds>&signature=<base64url-hmac-sha256>
```

La firma cubre `<id>:<expires>`, así que no se puede cambiar ni el fichero ni el
plazo. Se activa con `FERRIS_FILES_SIGNING_SECRET`; sin secreto, la firma está
desactivada y esas rutas no se emiten. El plazo se controla por entorno. Una URL
firmada caduca: no es un permiso permanente.

## Permisos

| Acción | Quién |
|---|---|
| subir | cualquier usuario con sesión |
| listar | el adaptador de `files.list`, según la implementación |
| descargar/borrar | la ACL del fichero (`AccessContext`) |
| servir por URL firmada | cualquiera con la firma válida y vigente |

Una app que implemente su propio `files.list` **hereda** la responsabilidad de
filtrar por usuario. El motor no la aplica por ti: el método sustituye al base.

## Límites

| Límite | Valor por defecto |
|---|---|
| tamaño por fichero | 50 MB (`max_file_size_mb`) |
| extensiones | todas si la lista está vacía |
| optimización de imagen | activa, calidad 85 |
| subida | bytes crudos, sin multipart |
| chunks temporales | `ferris-files/tus_uploads/`, no se versiona |

Subir un fichero mayor que el límite es un `validation-failed` (422), no un
corte de conexión silencioso.

## Mundo de la app: lo que no es el servicio

```rust
// El estado privado de la app. Nadie más lo ve, no hay ACL que aplicar.
std::fs::write("/world/files/export.csv", csv.as_bytes())?;
```

Ventajas: cero latencia de red, sin permisos que modelar, el fichero viaja con el
mundo. Límites: no se sirve por HTTP y no lo ve el Desk. Si necesitas ambas cosas,
escribe en `/world` y adjunta el resultado a un documento (o súbelo al servicio
con la sesión del usuario).

:::tip[Regla práctica]
Si el fichero lo va a abrir una persona desde el Desk, es del servicio. Si es
entrada/salida interna de la app (caché, exportaciones, material TLS), es del
mundo.
:::

## Checklist

* \[ ] `files` está compilado y `[features] files = true`.
* \[ ] `[files] backend` apunta a un destino que existe y es escribible.
* \[ ] `max_file_size_mb` y `allowed_extensions` son los que quieres, no los de
  ejemplo.
* \[ ] Si hay CDN, `cdn_url` es alcanzable desde el navegador.
* \[ ] Si usas URLs firmadas, `FERRIS_FILES_SIGNING_SECRET` está definido.
* \[ ] Un override de `files.list` filtra por usuario.
