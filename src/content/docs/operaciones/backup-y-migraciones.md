---
title: Backup y migraciones
description: Copias por motor, ficheros, mundos de plugins, orden de restauración y qué no se puede deshacer con ferris migrate.
---

Un backup de Ferris son **cuatro** cosas: base de datos, ficheros, mundos de
apps y la clave de los campos `Secret`. Restaurar solo la primera pierde
adjuntos, customizaciones o credenciales.

## Qué copiar

| Pieza | Dónde vive | Cómo se copia |
|---|---|---|
| Base de datos | PostgreSQL, MySQL o SQLite | Volcado lógico o snapshot del volumen. |
| Ficheros | `FERRIS_FILES_DIR` o el store de objetos | Copia del prefijo/volumen o versionado del bucket. |
| Mundos de apps | `<wasm_dir>/<app>/` (`apps/<app>/` en un bench, `sites/<site>/plugins/<app>/` en un sitio) | Copia del directorio completo. |
| Clave de secretos | `[secrets] key` / `FERRIS_SECRET_KEY` | Gestor de secretos, **fuera** del backup de la base. |
| Configuración | `config/ferris.toml` | Junto al despliegue, sin credenciales si se versiona. |

:::danger
Sin la clave de `[secrets]`, los campos `Secret` son indescifrables. No la
guardes en el mismo backup que la base de datos: una filtración se convierte en
un descifrado completo.
:::

## Backup por motor

### PostgreSQL

```bash
# Formato custom: comprimido y restaurable con pg_restore
pg_dump --format=custom --no-owner --no-acl \
  --file=/backup/erp-$(date +%F).dump \
  "postgres://ferris@db.internal:5432/erp"

# Restaurar en una base vacía
createdb -h db.internal -U ferris erp_restore
pg_restore --no-owner --no-acl --dbname=erp_restore \
  /backup/erp-2026-11-20.dump
```

Un `pg_dump` es consistente por sí mismo y no bloquea las escrituras normales.
Para bases grandes, combínalo con la retención de WAL si necesitas
point-in-time recovery.

### MySQL / MariaDB

```bash
mysqldump --single-transaction --routines --triggers --events \
  -h db.internal -u ferris -p erp > /backup/erp-$(date +%F).sql

mysql -h db.internal -u ferris -p erp_restore < /backup/erp-2026-11-20.sql
```

`--single-transaction` da una foto consistente en InnoDB sin bloquear la tabla.

### SQLite

```bash
# Copia consistente con la base abierta
sqlite3 /srv/ferris/mi-app.db ".backup '/backup/mi-app-$(date +%F).db'"

# Alternativa: escribe un fichero nuevo y compacto
sqlite3 /srv/ferris/mi-app.db "VACUUM INTO '/backup/mi-app-$(date +%F).db'"
```

Copiar el `.db` con `cp` mientras el proceso escribe puede producir un fichero
inconsistente. Usa `.backup`, `VACUUM INTO` o detén el proceso.

## Ficheros y objetos

Con store local:

```bash
FERRIS_FILES_DIR=/srv/ferris/files
tar -C "$(dirname "$FERRIS_FILES_DIR")" \
  -czf /backup/files-$(date +%F).tar.gz "$(basename "$FERRIS_FILES_DIR")"
```

Si el deploy usa `FileStore::open_shared()`, la raíz efectiva es
`FERRIS_FILES_DIR` o el directorio temporal del sistema. Confirma cuál es antes
de dar el backup por bueno: un store en `/tmp` no sobrevive a un reinicio.

Con S3, Azure o GCS, activa versionado y replicación en el bucket: un backup
lógico de la base no incluye los objetos.

## Mundos de plugins

```bash
tar -czf /backup/plugins-$(date +%F).tar.gz plugins/
```

Cada mundo contiene `customizations/` (metadatos exportados que aplica
`ferris migrate`), `data/`, `files/` y `secrets/`. Antes de una migración,
exporta las customizaciones que solo existen en el Desk:

```bash
curl -X POST http://localhost:8000/api/customization/Invoice/export \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"app": "facturacion"}'
```

Sin ese export, una customización hecha en el Desk y no guardada en el mundo no
está en el backup de `plugins/` y no se recreará en una base nueva.

## Orden de restauración

1. **Infraestructura**: base de datos vacía, Redis (opcional), volumen de
   ficheros y directorio de `plugins/`.
2. **Base de datos**: restaura el volcado en la base destino.
3. **Ficheros**: extrae el store en la ruta que diga `FERRIS_FILES_DIR`.
4. **Mundos**: extrae `plugins/` en el proyecto.
5. **Clave de secretos**: instala `[secrets] key` y, si hace falta,
   `previous_keys`, antes de arrancar.
6. **Configuración**: coloca `config/ferris.toml` con el entorno correcto.
7. **Migraciones**: `ferris migrate --dry-run` y luego `ferris migrate`.
8. **Verificación**: `ferris doctor`, `/health`, abrir un documento con adjunto y
   un campo `Secret`.

El paso 7 es el que aplica `<wasm_dir>/<app>/customizations/*.json` sobre la base
restaurada. En una base nueva, es lo que devuelve los Custom Fields y Property
Setters al estado que la app declara. En un despliegue con sitios, usa
`ferris site migrate <site>` para cada uno.

```bash
ferris migrate --dry-run
ferris migrate
ferris doctor
```

## Migraciones

```bash
ferris migrate --dry-run     # solo lista
ferris migrate               # aplica
ferris migrate --target 42   # se detiene en una versión
ferris migrate --force       # checksum distinto -> aviso, no error
```

El runner registra cada versión aplicada y su checksum. Un checksum distinto
significa que una migración ya aplicada cambió: por defecto es un error, porque
aplicarla de nuevo no es lo mismo que haberla aplicado bien. `--force` lo
degrada a aviso y debe ser una decisión consciente.

Cada DocType registrado genera una migración `create_table_<doctype>` con versión
derivada de su nombre. Dos DocTypes que colisionen en versión detienen la
migración en vez de perder una tabla.

### Rollback

**No hay rollback automático.** Las migraciones generadas llevan `down_sql`
(`DROP TABLE IF EXISTS ...`), pero `ferris migrate` no lo ejecuta y no existe un
`ferris migrate --down`.

Para revertir: restaura el backup anterior, escribe una migración nueva que
deshaga el cambio o elimina manualmente lo añadido, siempre con una copia a mano.

:::caution
Un `--target` menor no deshace migraciones: solo evita aplicar las que están por
encima. La base no vuelve a un esquema anterior por pedirlo.
:::

## Qué no se puede deshacer

- **Borrar un DocType, una tabla o una fila de `Custom Field`/`Property Setter`**:
  no hay historial de DDL, y `ferris migrate` solo reaplica lo que diga el mundo.
  Un `Secret` borrado sin la clave tampoco se recupera.
- **Mensajes descartados de la DLQ** sin consumirla antes.
- **Logs y filas de `Path Log`/`Error Log`** purgados: no son un registro
  inmutable.
- **Rotar una clave de secretos** sin conservar la anterior mientras queden
  filas: esas filas pasan a `UnknownKeyId`.

## Probar la restauración

Un backup no está probado hasta que se restaura. Hazlo en una base y un
directorio distintos:

```bash
createdb -h db.internal -U ferris erp_drill
pg_restore --no-owner --no-acl --dbname=erp_drill /backup/erp-2026-11-20.dump

export FERRIS_JWT_SECRET=...       # uno de pruebas, no el de producción
export FERRIS_SECRET_KEY=...       # el real, o los Secret no se leen
ferris --config /srv/drill/config/ferris.toml migrate --dry-run
ferris --config /srv/drill/config/ferris.toml doctor
```

Comprueba tres cosas concretas: un documento con adjunto se descarga, un campo
`Secret` se revela con la clave correcta y una customización exportada sigue
aplicándose.

## Retención

No hay retención automática. Define una política para los volcados de base de
datos, el store de ficheros y el versionado del bucket, los mundos de apps
(`apps/<app>/` en un bench, `sites/<site>/plugins/<app>/` en un sitio) antes de
cada despliegue, las claves de secretos anteriores (hasta reescribir todas las
filas) y `Path Log`/`Error Log`, que crecen sin límite.
