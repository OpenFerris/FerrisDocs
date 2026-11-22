---
title: Multi-tenant
description: El registro de tenants, cómo se aprovisiona cada uno, qué aísla de verdad y cómo migrarlo.
---

Un **tenant** es una instalación con su propia base de datos, su propio directorio
de ficheros, su propio Redis y su propio admin. `ferris tenant` administra el
registro; no convierte un proceso en servidor virtual multinquilino.

:::caution[Qué hace y qué no hace la 0.3.0]
`ferris tenant` crea y mantiene la **configuración** de cada tenant y aprovisiona
su base de datos y su directorio. El servidor arranca con **una** configuración
(`[database]`, `[files]`), así que servir varios tenants significa ejecutar una
instancia por tenant (con su propio `ferris.toml`) detrás de un proxy que enrute
por `Host`. El registro expone `resolve_host`, pero el servidor HTTP de esta
versión no lo consulta por petición.
:::

## El registro

Cada tenant es un fichero, `<root>/<id>.json`:

```text
tenants/
  0199c3f2-…json
  0199c401-…json
```

`<root>` es `tenants/` dentro del proyecto (`--dir`); `FERRIS_TENANTS_DIR` lo
sobreescribe. El registro es un fichero y no una tabla de control para no
necesitar una base de datos que guarde la configuración de las bases de datos, que
sería un segundo problema de arranque.

```json
{
  "id": "0199c3f2-7a4e-7c31-9d0e-2b1f6a8c5e10",
  "name": "acme",
  "host": "acme.example.com",
  "database": { "type": "postgres", "name": "acme", "host": "db", "port": 5432 },
  "redis_url": "redis://redis:6379",
  "files_path": "files/acme",
  "admin_email": "admin@acme.example.com",
  "admin_password_hash": "$argon2id$…",
  "enabled": true,
  "enabled_apps": ["acme-app"],
  "wasm_apps": [],
  "created_at": "2026-11-20T09:00:00Z",
  "updated_at": "2026-11-20T09:00:00Z"
}
```

| Campo | Aísla |
|---|---|
| `database` | filas, migraciones y esquema |
| `files_path` | adjuntos y blobs |
| `redis_url` | colas, schedules y pubsub |
| `enabled_apps` | qué apps publica esa instalación |
| `host` | clave de resolución |

## Crear

```bash
ferris tenant create acme \
  --host acme.example.com \
  --admin-email admin@acme.example.com
```

Sin `--admin-password`, la contraseña se lee de `FERRIS_ADMIN_PASSWORD` o se
pregunta por terminal con la entrada enmascarada. `--admin-password` existe y
funciona, pero queda visible en `ps` y en el historial del shell.

`create` hace tres cosas, en este orden:

1. deriva el nombre de la base (`--db-name` o un slug del nombre);
2. crea el directorio de ficheros y abre un pool para la base;
3. escribe el fichero del tenant con el hash de la contraseña.

En SQLite el fichero se crea; en Postgres/MySQL **la base debe existir**: el pool
falla si no.

## Listar, inspeccionar, habilitar

```bash
ferris tenant list
ferris tenant info 0199c3f2-7a4e-7c31-9d0e-2b1f6a8c5e10
ferris tenant disable 0199c3f2-…
ferris tenant enable  0199c3f2-…
```

`list` carga el registro completo y **reporta** los ficheros que no parsean en
lugar de hacerlos desaparecer: un tenant corrupto es un incidente, no un hueco.

`disable` no borra nada: deja de resolver por host y conserva configuración y
datos. Es la forma de aparcar un sitio.

## Migrar

```bash
ferris tenant migrate 0199c3f2-…
ferris tenant migrate 0199c3f2-… --target 12
```

Abre el pool del tenant y corre **sus** migraciones con el mismo runner que
`ferris migrate`. Si alguna falla, el comando sale con código distinto de cero:
un esquema roto no puede parecer un despliegue correcto.

En SQLite cada tenant es un fichero, así que migrar uno no toca a los demás. En
Postgres/MySQL el aislamiento es por base, no por esquema compartido.

:::note[Los tenants no heredan docTypes de otro]
Cada base arranca vacía y recibe las migraciones del framework más los DocTypes
de las apps que publique. Un `ferris tenant migrate` sobre una base nueva crea el
esquema; no copia datos de otro tenant.
:::

## Borrar

```bash
ferris tenant delete 0199c3f2-…
ferris tenant delete 0199c3f2-… --force
```

Borra la **configuración**, no los datos. El mensaje de confirmación lo dice. Un
borrado accidental de configuración se reconstruye; uno de base de datos, no.

## Aislamiento real

| Recurso | Aislado | Cómo |
|---|---|---|
| datos | sí | base de datos propia |
| ficheros | sí | `files_path` propio |
| colas/schedules | sí | `redis_url` propio (o prefijo de cola) |
| apps | sí | `enabled_apps` |
| secretos de apps | sí | mundo `plugins/<app>/` por instalación |
| sesiones | sí | `[auth] jwt_secret` por instalación |
| código | no | el mismo binario para todos |

Dos tenants en el **mismo** Redis comparten espacio de claves: usa bases de Redis
distintas (`redis://host/1`, `/2`, …) o instancias separadas, o un tenant podrá
ver las claves de otro.

## Buenas prácticas

- Un `jwt_secret` distinto por tenant. Compartirlo permite que una sesión de un
  sitio valga en otro.
- Un directorio de ficheros por tenant, nunca uno compartido con prefijos: un
  fallo de validación de ruta se convierte en fuga entre clientes.
- Migra **antes** de arrancar la instancia nueva; el arranque no migra.
- Versiona el `ferris.toml` de cada tenant junto a su `[apps]`, no el registro
  `tenants/*.json` (contiene hashes y rutas locales).
- Si necesitas borrar un tenant de verdad, borra base y ficheros con tus propias
  herramientas y verifica la copia de seguridad antes.

## Checklist

- [ ] `--host` es el nombre real por el que llega el tráfico (y el proxy lo
      preserva).
- [ ] La base existe antes de `create` (Postgres/MySQL).
- [ ] `files_path` es escribible por el usuario del proceso.
- [ ] El tenant tiene su propio `jwt_secret` y su propio espacio de Redis.
- [ ] `ferris tenant migrate` termina con código 0.
- [ ] `enabled_apps` nombra apps que existen en el `wasm_dir` de esa instancia.
