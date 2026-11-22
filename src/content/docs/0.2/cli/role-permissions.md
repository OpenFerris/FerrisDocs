---
title: ferris role-permissions
description: Lee y escribe las filas DocPerm en la base configurada, con sus
  derechos, permlevel y alcance, y por qué un cambio por CLI no se aplica hasta
  reiniciar.
slug: 0.2/cli/role-permissions
---

`ferris role-permissions` gestiona las filas de permisos por rol y DocType que
el motor de autorización fusiona en cada arranque. Es el equivalente en CLI del
*Role Permissions Builder* del Desk.

```bash
ferris role-permissions <list|set|delete>
```

Requiere un proyecto (`Cargo.toml`) y una base alcanzable: abre el pool con la
configuración del proyecto, igual que `migrate`.

## `list [doctype]`

Sin argumentos lista todas las filas; con un DocType, solo las suyas. La salida
es un array JSON con la fila completa (todos los derechos, `permlevel`,
`if_owner` y `apply_to_all_doctypes`).

```bash
ferris role-permissions list
ferris role-permissions list Invoice
```

## `set <doctype> <role>`

Crea o reemplaza **la fila entera** para la clave natural
`(doctype, role, permlevel)`.

```bash
ferris role-permissions set <doctype> <role> [flags]
```

| Flag | Efecto |
|---|---|
| `--permlevel <N>` | Nivel de permiso; por defecto `0`. |
| `--read` | Lectura. |
| `--write` | Escritura. |
| `--create` | Creación. |
| `--delete` | Borrado. |
| `--submit` | Envío (documentos sometibles). |
| `--cancel` | Cancelación. |
| `--amend` | Enmienda. |
| `--print` | Impresión. |
| `--email` | Envío por email. |
| `--share` | Compartición. |
| `--report` | Informes. |
| `--import` | Importación. |
| `--export` | Exportación. |
| `--if-owner` | El derecho solo alcanza a documentos cuyo `owner` es el usuario. |
| `--all-doctypes` | Aplica la regla a todos los DocTypes, no solo al indicado. |

Los flags son **el estado completo** de la fila, no incrementos: un `set` sin
`--read` escribe `read = false`. Para añadir un derecho, repite los que quieras
conservar.

```bash
# un rol de lectura y escritura, sin borrado
ferris role-permissions set Invoice "Billing User" --read --write --create

# solo sobre sus propios documentos
ferris role-permissions set Invoice "Billing User" --read --if-owner

# un rol que vale para cualquier DocType
ferris role-permissions set Invoice "Auditor" --read --report --all-doctypes
```

`--permlevel` mayor que 0 se **almacena** pero el motor no lo traduce: los
controles a nivel de campo no existen todavía, y el comando lo avisa. Un
`permlevel 0` es el que participa en las sentencias de autorización.

## `delete <doctype> <role>`

Elimina **todas** las filas de ese par, en todos los niveles de permiso:

```bash
ferris role-permissions delete Invoice "Billing User"
```

No hay `--force` ni confirmación: el comando borra y termina.

## Dónde se guarda y cuándo se aplica

Las filas son documentos `DocPerm` escritos por el motor de documentos, así que
una fila creada por CLI y una creada por REST son la misma fila y pasan por la
misma validación y los mismos hooks. La clave natural
`(doctype, role, permlevel)` hace que un `set` repetido sobrescriba en vez de
duplicar.

La diferencia importante es **cuándo surte efecto**:

| Vía | Efecto |
|---|---|
| `ferris role-permissions set` / `delete` | Escribe en la base. Un servidor en marcha lo lee en su **próximo reinicio**. |
| `POST /api/authz/role-permissions` (Desk) | Escribe y **recarga en caliente** la política del servidor que atiende la petición. |

::\:caution Un cambio por CLI no es un cambio en vivo
Si editas permisos mientras el servidor corre, la API seguirá aplicando la
política anterior hasta que reinicies. El propio comando lo recuerda al escribir;
para un cambio inmediato usa el endpoint del Desk.
::\:

## Ejemplos completos

```bash
# ver qué hay hoy
ferris role-permissions list

# dar lectura/escritura/creación a un rol de módulo
ferris role-permissions set "Sales Order" "Sales User" --read --write --create

# permitir envío solo a un manager
ferris role-permissions set "Sales Order" "Sales Manager" \
  --read --write --create --submit --cancel --amend

# quitar el acceso de un rol
ferris role-permissions delete "Sales Order" "Sales User"

# mismo cambio en otro proyecto
ferris --dir /srv/billing role-permissions list Invoice
```

::\:note Coherencia con la política declarada
El motor instala las reglas declaradas en el código y las de esta tabla en el
mismo arranque, con una sola traducción. Una fila que contradiga una regla
declarada no se “arregla” sola: ambas se combinan según la política del motor, y
por eso conviene revisar `list` antes de asumir qué está permitido.
::\:
