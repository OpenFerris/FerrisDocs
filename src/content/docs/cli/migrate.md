---
title: ferris migrate
description: Qué aplica ferris migrate, cómo se generan y registran las migraciones de DocType, la idempotencia, el guardián de checksum y las customizaciones de los mundos de plugin.
---

`ferris migrate` corre las migraciones **en proceso** contra la base configurada
en `config/ferris.toml`. No invoca binarios externos ni arranca el servidor.

```bash
ferris migrate [-t VERSION] [--dry-run] [--force]
```

| Flag | Efecto |
|---|---|
| `-t`, `--target <VERSION>` | Se detiene en la última migración con versión ≤ `VERSION`. |
| `--dry-run` | Lista las migraciones pendientes y sale sin aplicar nada. |
| `--force` | Convierte un desajuste de checksum en aviso en vez de error. |

## Qué hace, en orden

1. Comprueba que hay proyecto (`Cargo.toml`) y abre el pool. `create_pool` crea
   si falta la tabla de contabilidad `_ferris_migrations`
   (`version`, `name`, `checksum`, `applied_at`, `execution_time_ms`).
2. Construye el runner con el dialecto **del pool**: PostgreSQL, MySQL o SQLite
   según la conexión, para que el DDL y la base no puedan discrepar.
3. Registra una migración por cada DocType que conozca el registro del proceso.
   La versión se deriva solo del nombre del DocType (FNV-1a por encima de
   `1_000_000`, espacio reservado a las migraciones escritas a mano), de modo que
   añadir o quitar otros DocTypes no renumera los existentes. Dos nombres que
   colisionen son un error explícito, no una tabla perdida en silencio.
4. Con `--dry-run`, imprime `versión  nombre` de cada pendiente y termina. No
   aplica migraciones **ni** customizaciones.
5. Aplica las pendientes en orden ascendente de versión y registra versión y
   checksum de cada una. Un fallo se cuenta y el comando termina con error.
6. Aplica las customizaciones de los mundos de plugin (ver más abajo).

## Qué contiene cada migración

Cada DocType genera `create_table_<doctype>` con:

- `CREATE TABLE tab<DocType>` con las columnas estándar
  `name` (`VARCHAR(255)`, clave primaria), `owner`, `docstatus` (`SMALLINT`,
  por defecto 0), `creation` y `modified` (`BIGINT`) y `data` (`TEXT NOT NULL`).
  El documento completo vive en `data`; las otras columnas se duplican porque
  son las que las listas ordenan y filtran.
- Los tres índices estándar: `idx_owner`, `idx_modified` e `idx_docstatus`.
- Los índices declarados en `meta.indexes`. Si todos sus campos son columnas
  reales, se crea un índice normal; si es un único campo que vive dentro de
  `data`, se crea un índice de expresión JSON; una combinación de campos sin
  columna se omite, porque no tiene una forma portable.
- `DROP TABLE IF EXISTS tab<DocType>` como `down_sql`.

El nombre de la tabla se forma quitando espacios y exigiendo solo caracteres
ASCII alfanuméricos o `_`; `To Do` y `ToDo` dan `tabToDo`.

:::note Las tablas también se crean de forma perezosa
`migrate` no arranca el servidor ni carga plugins: su registro solo contiene los
DocTypes que el proceso de la CLI haya registrado. En la práctica, las tablas del
framework aparecen cuando el servidor sirve por primera vez ese DocType, porque
el motor hace `CREATE TABLE IF NOT EXISTS` antes de leer o escribir. Lo mismo
vale para las tablas auxiliares `tab_series` (contadores de naming),
`tab_version` (historial), `tab_share` (comparticiones) y `tab_assignment`
(asignaciones): se materializan en el primer uso.
:::

## Idempotencia

- Reejecutar `ferris migrate` no repite nada: cada versión aplicada está en
  `_ferris_migrations`.
- Si el SQL de una migración ya aplicada cambia, el checksum registrado deja de
  coincidir y el comando **falla** con la lista de versiones afectadas. Es la
  señal de que la base y el código discrepan. `--force` lo degrada a aviso; no
  reescribe la fila ni el esquema.
- Las customizaciones de los mundos son *upserts*: aplicar dos veces el mismo
  fichero deja una sola fila. Borrar un campo del mundo **no** borra la fila de
  la base; eso es una acción explícita del Desk.
- En PostgreSQL y MySQL la tanda se aplica bajo un lock de la base
  (`pg_advisory_lock` y `GET_LOCK`), así que dos procesos que migran a la vez no
  aplican la misma versión por duplicado. SQLite no toma ese lock.

## Customizaciones de los mundos de plugin

Después de las migraciones, `migrate` recorre `<apps.wasm_dir>` (por defecto
`plugins/`) y, para cada mundo de app habilitada, lee
`customizations/*.json` en orden de nombre de fichero y lo aplica a
`tab_custom_field` y `tab_property_setter`. El fichero guarda el DocType dentro
del JSON (`doctype`, `fields`, `properties`), porque el nombre del fichero está
saneado y no se puede invertir.

Esto es el modelo de *fixtures* de Frappe: la app es dueña del payload y la base
es una proyección. Se aplica en **migrate**, no en cada arranque, para que una
personalización hecha en el Desk y aún no exportada no se revierta al reiniciar.
Un fichero malformado falla la migración nombrando el fichero; no se salta en
silencio. Si `plugins/` no existe, no es un error: un despliegue solo de
framework migra igual.

## Ejemplos

```bash
# ver qué falta, sin tocar la base
ferris migrate --dry-run

# aplicar todo
ferris migrate

# aplicar hasta una versión concreta
ferris migrate --target 1000005

# aceptar deriva de checksum (con aviso)
ferris migrate --force

# el proyecto de otro directorio
ferris --dir /srv/billing migrate
```

Salida típica de una migración aplicada:

```text
  ✓ 1000007 (create_table_invoice) in 12ms
```

:::danger No edites una migración ya aplicada
Cambiar el SQL de una versión registrada invalida el checksum y bloquea el
siguiente `migrate` hasta usar `--force`. Añade una migración nueva en vez de
reescribir la historia.
:::
