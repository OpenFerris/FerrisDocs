---
title: Metadatos y doctypes
description: Endpoints que describen el esquema, los permisos, la personalización y la configuración de presentación del Desk.
---

El Desk pide los DocTypes al servidor: estas rutas son el contrato entre la
metadata y la interfaz, y sirven igual a una app externa.

## `GET /api/doctype/meta/{doctype}`

Devuelve la metadata **efectiva**: la declaración compilada, con
personalizaciones (`Custom Field`, `Property Setter`) y `Custom DocPerm`
aplicados.

```bash
curl -s -b cookies.txt http://localhost:8000/api/doctype/meta/Task | jq
```

Un DocType desconocido es `404`, nunca `200 null`.

Forma del payload (`DynMeta`):

| Campo | Tipo | Para qué |
|---|---|---|
| `name` | string | Nombre del DocType |
| `module` | string | Sección del Desk a la que pertenece |
| `title_field`, `search_fields`, `date_field` | string / string[] / string? | Título, campos del selector de enlaces y fecha de calendario |
| `naming_series` | string | Serie declarada (`TASK-.#####`) |
| `naming_type` | string? | `series`, `uuid`, `auto`, `field`, `prompt` |
| `naming_field` | string? | Campo del que se lee el nombre |
| `fields` | objeto[] | Campos: `fieldname`, `label`, `fieldtype`, `options`, `reqd`, `permlevel`, … |
| `is_submittable` | bool | Acepta `submit`/`cancel` |
| `is_single` | bool | Tiene un único documento |
| `is_child_table` | bool | Es tabla hija de otro DocType |
| `is_virtual` | bool | Lo sirve un proveedor de datos |
| `hidden` | bool | No aparece como enlace de workspace |
| `read_only` | bool | No se edita |
| `allow_submit` / `allow_cancel` / `allow_amend` | bool | Affordances del formulario |
| `allow_delete` / `allow_copy` / `allow_print` | bool | Ídem |
| `allow_rename` | bool | Habilita `POST …/rename` |
| `in_list_view` / `in_calendar` / `in_kanban` / `in_gantt` / `in_tree_view` / `in_report_view` | bool | Vistas que ofrece la barra superior |
| `default_view` | string? | Vista de colección que abre `/desk/{module}/{doctype}` (`list`, `kanban`, `calendar`, `tree`, `gantt`, `report`) |
| `kanban_group_field` | string? | Campo de agrupación del tablero: `Select` con varias opciones o `Link` |
| `kanban_card_fields` | string[] | Campos visibles en cada tarjeta |
| `calendar_end_field` / `calendar_title_field` | string? | Fin del evento y título de la tarjeta del calendario (`date_field` es el inicio) |
| `tree_parent_field` / `tree_label_field` | string? | `Link` al mismo DocType que anida el árbol y campo de etiqueta |
| `tree_expanded_levels` | number? | Niveles abiertos la primera vez (0–10) |
| `gantt_start_field` / `gantt_end_field` | string? | Fechas que dibujan la barra |
| `gantt_dependency_field` / `gantt_progress_field` | string? | Predecesor (`Link` al mismo DocType) y progreso 0–100 |
| `view` / `dashboard` | objeto | Vista por defecto y dashboard asociado |
| `indexes` | objeto[] | Índices; el Desk usa sus campos como columnas |
| `permissions` | objeto[] | Reglas por rol (`role`, `permlevel`, `if_owner`, …) |
| `actions` | objeto[] | Filas de `DocType Action` |
| `links` | objeto[] | Filas de `DocType Link` (panel Connections) |
| `custom_permissions` | objeto[] | Tipos de permiso declarados en `Permission Type` |

:::tip[`permissions` es una pista, no la autorización]
El payload permite al Desk decidir qué botones **ofrecer**; la decisión real la
toma el motor en cada lectura/escritura. Ocultar un botón no concede nada.
:::

## Acciones, conexiones y tipos de permiso

```bash
# Botones declarados para el formulario
curl -s -b cookies.txt http://localhost:8000/api/doctype/actions/Task
# {"actions":[{"name":"…","label":"Aprobar","action_type":"Route","action":"/desk/…","group":null,"hidden":false}]}

# Panel de conexiones de un documento concreto
curl -s -b cookies.txt \
  http://localhost:8000/api/doctype/connections/Project/PROJ-0001
```

`connections` devuelve grupos por `DocType Link`:

```json
{
  "connections": [
    {
      "link_doctype": "Task",
      "link_fieldname": "project",
      "group": null,
      "count": 3,
      "documents": [{ "name": "TASK.00001", "title": "Revisar el README" }]
    }
  ]
}
```

Los enlaces externos se resuelven con un `WHERE` sobre `link_fieldname`; los que
viven dentro de una tabla hija (`table_fieldname`) se escanean como JSON con un
tope duro de **100 documentos**, porque la columna no es indexable. Los grupos
vacíos se omiten.

Los tipos de permiso se leen aparte:

```bash
curl -s -b cookies.txt http://localhost:8000/api/doctype/permissions/Task
# {"custom":[{"perm_type":"approve","granted":true}]}
```

`granted` se resuelve para **tu** usuario, no para el rol.

## Matriz de permisos

```bash
# Ver la matriz rol × tipo
curl -s -b cookies.txt \
  http://localhost:8000/api/doctype/permissions/Task/manage

# Conceder o revocar un tipo
curl -s -b cookies.txt -X PUT \
  http://localhost:8000/api/doctype/permissions/Task/manage \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"role":"Projects User","perm_type":"approve","granted":true}'
# {"ok":true}
```

El `PUT` escribe la fila y reconstruye la política con el mismo camino que un
arranque: el cambio es efectivo sin reiniciar y no puede contradecir al motor.

Para permisos de documento completos existe el constructor de roles:

```text
GET    /api/authz/role-permissions?doctype=Task
POST   /api/authz/role-permissions
DELETE /api/authz/role-permissions/{doctype}/{role}
```

Solo responden a `System Manager` o `Administrator`; el resto recibe `403`.

## Presentación del Desk

| Ruta | Devuelve |
|---|---|
| `GET /api/modules` | `DeskLayout`: iconos del grid y workspaces (`icons`, `workspaces`) |
| `GET /api/site-settings` | `title_prefix`, `home_page`, `announcement`, `help_link`, `logo`, `language` |
| `GET /api/themes` | Lista de `ThemeSpec` (`id`, `label`, `dark`, `vars`) |
| `GET /api/ui-extensions` | `UiFeed`: `revision` y `apps[]` con widgets, dashboards y extensiones |
| `GET /api/search?q=…` | Resultados globales; vacío si no hay `q` |

`/api/site-settings` lee tres Singles (`Website Settings`, `Navbar Settings`,
`System Settings`) **sin** el chequeo de lectura, porque son valores públicos del
sitio; cada campo ausente se proyecta como cadena vacía. `/api/search` respeta
`Global Search Settings` (`enabled`, `max_results`) y solo recorre DocTypes no
ocultos, no virtuales, no child y no single.

`/api/themes` devuelve primero los temas integrados `light` y `dark`, luego los
que registró una app; un tema registrado con el mismo `id` reemplaza al
integrado.

## Desired state

Estado durable por entidad para agentes que hacen *pull*:

```bash
# Listar, pull condicional, publicar y limpiar
curl -s -b cookies.txt http://localhost:8000/api/desired-state
curl -s -b cookies.txt -H 'If-None-Match: "7"' \
  http://localhost:8000/api/desired-state/edge-01
curl -s -b cookies.txt -X PUT \
  http://localhost:8000/api/desired-state/edge-01 \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"payload":{"sampling":30},"expected_version":7}'
curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X DELETE \
  http://localhost:8000/api/desired-state/edge-01 -H "X-CSRF-Token: $CSRF"
```

El pull devuelve `{"entity","version","payload","updated_at"}`; si el
`If-None-Match` coincide, `304` sin cuerpo. Publicar responde `201` si la entidad
es nueva y `200` si ya existía; un `expected_version` obsoleto es `409` con
`current_version`. `GET` sin entidad devuelve el array, la más reciente primero.
Leer puede cualquier usuario autenticado; escribir es de `System Manager`.

:::caution[El compare-and-set no es atómico]
Leer la versión y escribir son dos pasos: dos publicadores concurrentes con la
misma versión esperada pueden pasar ambos. Con un solo escritor basta; con
varios, serializa en el control plane.
:::

## Personalización

```text
GET    /api/customization/{doctype}
POST   /api/customization/{doctype}/fields
DELETE /api/customization/{doctype}/fields/{fieldname}
POST   /api/customization/{doctype}/properties
DELETE /api/customization/{doctype}/properties/{property}
POST   /api/customization/{doctype}/export
```

`GET` devuelve los custom fields y property setters efectivos. `POST …/fields`
responde `201` con el campo guardado; borrar responde `204`. `export` escribe
`plugins/<app>/customizations/<doctype>.json` para que `ferris migrate` lo
reaplique en otra base de datos. Requiere permiso de personalización sobre el
DocType.

## Widgets

```text
GET /api/widgets/{app}/{name}/script.js
GET /api/widgets/{app}/{name}/style.css
```

Sirven el código guardado en la fila `Widget` cuando no declara `code_path`, con
`Cache-Control: no-store` (la fila es editable). Si el widget no existe, está
deshabilitado o no tiene script, responden `404` en texto plano.
