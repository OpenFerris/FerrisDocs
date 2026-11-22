---
title: Permisos
description: DocPerm, el motor de políticas con deny-wins, el atajo de owner, los niveles de campo y las capas de personalización del sitio.
---

Hay tres capas y conviene no confundirlas: **`PermissionRule`** (la fila
`DocPerm` que declara la app), la **política instalada** (`PolicyStatement`s que el
motor evalúa en cada comprobación) y la **personalización del sitio**
(`Custom DocPerm`, que se funde sobre las reglas antes de instalar la política y
antes de servir la metadata). Se aplican en ese orden: la declaración, el override
del sitio y, con ambas, la política que decide cada petición.

## Las acciones

```rust
pub enum Permission {
    Read, Write, Create, Delete, Submit, Cancel, Amend,
    Print, Email, Share, Report, Import, Export, Manage,
}
```

`Permission::grants(action)` devuelve `true` si son iguales **o** si la concedida
es `Manage`. Es decir: en una política instalada, `Manage` significa todas.

En una **fila** `DocPerm`, en cambio, `check(Manage)` equivale a
`read && write && delete`. Son dos semánticas distintas: la
traducción de una fila a política itera solo los 13 derechos de `DOC_RIGHTS`
(`Manage` excluido), así que una fila de tres derechos nunca se convierte en una
de trece.

## La fila `DocPerm`

```rust
pub struct PermissionRule {
    pub role: String,
    pub read: bool, pub write: bool, pub create: bool, pub delete: bool,
    pub submit: bool, pub cancel: bool, pub amend: bool,
    pub print: bool, pub email: bool, pub share: bool, pub report: bool,
    pub import: bool, pub export: bool,
    pub permlevel: u8, pub if_owner: bool, pub apply_to_all_doctypes: bool,
    pub custom_permissions: Vec<String>,
}
```

`Default` es todo `false`: una regla que no nombra un derecho no concede nada.

## De la fila a la política

`doc_type_policy(doctype, rules, caps)` traduce cada regla y devuelve también las
que **no** pudo representar, para que el llamante las registre en lugar de
perderlas en silencio:

| Motivo | Regla descartada |
|---|---|
| `Permlevel` | `permlevel != 0`. Los niveles son permisos de campo, no de documento; concederlos como derechos de documento daría acceso a todos los campos. |
| `NoRole` | Rol vacío: no está en la lista de roles de nadie. |
| `OwnerOnlyCreate` | `if_owner` cuyo único derecho era `create` (el owner no aplica a un documento que aún no existe). |
| `NoRights` | Ningún derecho sobrevivió a los filtros de capacidad. |

Los filtros de capacidad se aplican como "el derecho no se concede", no como un
deny (porque un deny en este motor es un veto global): un DocType no submittable
pierde `submit` y uno sin `allow_import` pierde `import`.

Forma del recurso, doble a propósito porque Ferris identifica un documento de dos
maneras:

```text
Resource::new(doctype, "*")       // "¿puede este rol tocar este DocType?"
Resource::new("doctype", doctype) // sonda a nivel de DocType (SSR, realtime)
```

Una sola alcanzaría solo la mitad del framework. En una regla con
`apply_to_all_doctypes`, ambas se sustituyen por `("*", "*")`. El rol `All` no se
guarda en cada usuario: se traduce a `Principal::everyone()`, que casa con
cualquier principal **autenticado**.

## Evaluación

```text
check_permission(user, resource, action)
  ├─ System Manager → true
  ├─ por cada principal (roles + el propio usuario + Everyone):
  │     cualquier Deny  → false
  │     algún Allow     → true
  └─ atajo de owner para Read | Write | Amend
```

Propiedades: **deny gana siempre** (un `Deny` de un rol anula el `Allow` de otro);
**sin sentencia no hay acceso** (el motor por defecto solo concede todo a
`System Manager`, no hay lectura global para `Everyone`); los principales
**incluyen el usuario mismo**, no solo sus roles, o una política por usuario sería
inalcanzable; y hay **jerarquía de roles** (`role_hierarchy`), consultada al
comparar un principal de tipo `Role`.

## El atajo de owner

Después de la política, si la acción es `Read`, `Write` o `Amend` y
`resource.owner == user.id`, se concede. Nunca para `Delete`, `Submit`, `Cancel`,
`Import`, `Export`, `Print`, `Email`, `Share`, `Report` ni `Manage`.

El owner **siempre viene de la fila almacenada**, jamás del body. El motor lee la
columna `owner` y la pasa como `trusted_owner`; un `PUT` con `{"owner": "<yo>"}`
se rechaza con `400` antes de autorizar. Leer el owner del mapa mezclado
permitiría tomar el control de un documento ajeno y persistir el cambio sin
rastro.

Un Single no tiene atajo de owner: su único documento es global y se autoriza solo
por rol.

## `if_owner`

`DocPerm.if_owner` no se puede expresar con rol + recurso, porque el recurso
identifica al dueño del documento, no al solicitante. Se representa con una
condición en la sentencia:

```rust
statement.with_condition("is_owner", Value::Bool(true))
```

`OWNER_CONDITION` es `"is_owner"`, y el contexto de la comprobación lo rellena con
`owner == user.id && !owner.is_empty()`. Una condición cuyo key no está en el
contexto **no casa**: el contexto debe rellenar `is_owner` en cada llamada, o toda
regla condicionada queda inalcanzable.

## Niveles de campo (`permlevel`)

`permlevel` es un nivel de permiso **de campo**, no de documento, resuelto por
`has_permlevel_access(rules, user, action, permlevel)`:

- `permlevel == 0` → el documento: si el llamante pasó la comprobación de
  documento, pasa esta.
- `permlevel > 0` → hace falta una fila `DocPerm` con **ese** `permlevel`, el
  derecho pedido y uno de los roles del llamante (o `All`).
- `System Manager` alcanza todos los niveles.

Efectos en el motor:

| Situación | Qué hace |
|---|---|
| Campo de lectura restringido | `redact_read` lo **elimina** del documento devuelto. |
| Campo de escritura restringida | `apply_field_permissions_write` lo **quita** del body; el valor almacenado sobrevive. |
| `Password` | Se enmascara en toda lectura HTTP, incluido System Manager. |
| `Secret` | Se enmascara **siempre**; el texto plano solo por `read_secret` en un contexto de servidor. |
| Campo con `mask` | Se devuelve enmascarado salvo que un rol tenga el permiso `mask` en ese `permlevel` (`All` incluido). |

## `Custom DocPerm`

Es la capa del sitio: la app trae sus `DocPerm`, y una edición de permisos guarda
un override en `tabCustomDocPerm`. Dos lectores deben coincidir o el Desk y el
motor concederían cosas distintas: `effective_meta` funde los overrides en el
payload de metadata, e `install_policies_with_role_permissions` los funde en la
política de runtime. Ambos pasan por `merge_rules`, la única definición de qué
significa un override: sin `select`, la fila reemplaza la regla del mismo
`(role, permlevel)`; con `select`, reemplaza **todas** las reglas de ese role. Un
`custom_permissions` mal formado es un error de serialización, nunca una concesión
vacía silenciosa.

## Permission Type y custom_permissions

Un `Permission Type` declara un derecho con nombre propio (`approve`, `verify`, …)
para un DocType. La **declaración** vive en `tabPermissionType`; la **asignación**
a roles vive en `Custom DocPerm.custom_permissions`, como lista de cadenas, y se
consulta con `has_custom_permission(pool, user, doctype, perm_type)` o
`has_custom_permission_on(…, Some(owner), …)`.

La primera es a nivel de DocType y por eso **ignora** las reglas `if_owner` (no
puede saber el owner). La segunda recibe el owner y aplica la semántica completa.
`System Manager` devuelve `true` en ambas. La comparación de nombres es por texto
recortado, porque el tipo lo define la app.

## `ReadScope`: qué filas puede listar

`Decision` responde por un recurso; una lista necesita la respuesta **antes** de la
primera fila, porque aplicar `LIMIT` antes de filtrar acortaría la página y haría
que `total` contara filas invisibles.

```rust
pub enum ReadScope { All, Owner, PerRow, None }
```

`PermissionEngine::read_scope` analiza las sentencias que podrían alcanzar el
DocType: un `Deny` que cubre todas las filas → `None`; un `Allow` universal →
`All`; cualquier allow/deny parcial → `PerRow` (se evalúa fila a fila, como
`check`); y si no hay nada universal → `Owner` (`WHERE owner = ?`), porque el atajo
de owner concede lectura sobre las propias.

Una sentencia con `name` concreto, o con una condición distinta de
`is_owner = true`, cae siempre en `PerRow`: no hay expresión SQL portable para
ella. Las filas compartidas (`tab_share`) se cargan una vez por página como
conjunto de nombres, no con una consulta por fila.

## Metadata vs política instalada

El Desk recibe `DynPermissionRule`s para decidir qué **ofrecer**
(`DynMeta::offers_create`). Eso es una regla de affordance, no de autorización: si
dice `true` de más, la petición acaba en `403`. La autorización real la decide el
motor con la política **instalada**, que se instala al arrancar con
`set_global_engine` antes de servir peticiones; una comprobación anterior ve el
motor por defecto (solo System Manager). El estado es procesal, así que los tests
que instalan un motor propio deben serializarse entre sí.
