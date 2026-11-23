---
title: DocTypes incluidos
description: "Catálogo por módulo de los DocTypes que declara el framework: metadatos, datos, Desk, identidad, verticales y sistema."
---

El framework registra sus propios DocTypes como datos: cada uno vive en una crate
y se declara con `DoctypeMeta`, de modo que el Desk puede listarlos sin una tabla
hardcodeada. El **módulo** es la sección del Desk a la que pertenece.

Esta página agrupa por familia. No lista campos: para eso, la fuente es
`GET /api/doctype/meta/{doctype}`.

## Build — metadatos y herramientas de esquema

| DocType | Para qué |
|---|---|
| `DocType` | La forma almacenada del registro de esquema: una fila por DocType, con `meta_json` completo |
| `DocField` | Campo de un DocType (tabla hija de `DocType`) |
| `Customize Form` | Interruptor de personalización por formulario |
| `Custom Field` | Campo añadido en tiempo de ejecución |
| `Property Setter` | Sobrescribe una propiedad de un campo o DocType, incluido `insert_after` |
| `Custom DocPerm` | Regla de permiso específica del sitio, por encima de la declarada |
| `Custom Translation` | Traducción que sobrescribe la de un fichero |
| `DocType Action` | Botones del formulario (ruta, método, grupo) |
| `DocType Link` | Enlaces del panel Connections, incluidos los de tabla hija |
| `Permission Type` | Declara derechos de acción como `approve` |
| `Module Def` | Módulo con el que una app agrupa sus DocTypes |
| `Global Search Settings` (Single) | Activa la búsqueda global y su `max_results` |
| `Client Script` / `Server Script` | Scripts almacenados |
| `Navbar Settings` (Single) | Anuncio, enlace de ayuda y logo de la barra |
| `Report` | Informe de consulta guardado |
| `Dashboard` / `Dashboard Widget` | Dashboard y sus tarjetas |
| `Widget` / `Widget Param` | Widget del Desk (custom element) y sus parámetros |
| `Kanban Board`, `Calendar View`, `List Filter`, `Page` | Vistas y páginas guardadas |
| `Dashboard Chart`, `Number Card`, `Custom HTML Block` | Definiciones que referencian `Workspace Chart`, `Workspace Number Card` y `Workspace Custom Block` |
| `DocType Layout` | Layout de formulario referenciado por `Workspace Link` |
| `Module Onboarding` | Flujo de incorporación referenciado por `Workspace` |
| `Workspace` + `Workspace Link`, `Shortcut`, `Chart`, `Number Card`, `Quick List`, `Custom Block` | Navegación del Desk y sus bloques |
| `Domain` | Dominio al que se restringen un workspace o un shortcut |
| `Country`, `Currency`, `Language`, `Translation` | Datos GEO (módulo `GEO`) |

:::note[Código frente a datos]
`DocType` y `DocField` son DocTypes normales, pero su contenido se sincroniza
desde el registro compilado (`DoctypeStore`). Editar la tabla a mano no cambia
el esquema que usa el motor.
:::

## Data — importación, exportación y naming

| DocType | Para qué |
|---|---|
| `Data Import` / `Data Import Log` | Carga masiva y su registro de resultados |
| `Data Export` | Exportación programada o guardada |
| `Document Naming Rule` / `Document Naming Rule Condition` | Reglas de renombrado por condición |
| `Document Naming Settings` (Single) | Ajustes globales de naming |
| `Prepared Report` | Informe preparado en segundo plano |

## Desk — notificaciones, paneles y colaboración

| DocType | Para qué |
|---|---|
| `Notification` | Notificación in-app para un usuario |
| `Notification Log`, `Notification Settings` | Historial y preferencias |
| `Event` | Evento del feed de actividad |
| `Desk Layout`, `Dashboard Layout`, `Dashboard Settings` | Posición de iconos, layout por dashboard y estilo global |
| `Desired State` | Configuración publicada por entidad para agentes de borde |
| `ToDo` | Tarea rápida asociada a un documento |
| `Tag` | Etiqueta; `Tag Link` es su tabla de unión interna |
| `Bulk Update` | Actualización masiva de un campo en un conjunto de documentos |

## Users — identidad y permisos

| DocType | Para qué |
|---|---|
| `User` | Cuenta: email, username, roles, MFA, estado |
| `Role`, `Has Role`, `User Type`, `Role Profile`, `Module Profile` | Modelo de roles y perfiles |
| `User Group` | Agrupación de usuarios |
| `User Permission`, `User Doctype Permissions` | Restricciones por usuario |
| `DocPerm` / `Custom DocPerm` | Derechos por rol y DocType (el segundo los sobrescribe) |
| `Session` | Sesión abierta (cookie `ferris_session`) |
| `API Key` | Clave `Authorization: token <key>:<secret>` |
| `Activity Log`, `Access Log` | Registro de acciones y accesos |
| `User Invitation` | Invitación pendiente |
| `Document Share Report`, `Permission Inspector`, `Permitted Documents For User` | Diagnóstico de quién ve qué |
| `Role Permission Manager`, `Role Permission for Page and Report` | Constructor de permisos y permisos de páginas |

## Email — correo

| DocType | Para qué |
|---|---|
| `Email Account` | Cuenta SMTP/IMAP con TLS/STARTTLS |
| `Inbound Email` | Mensaje recibido por IMAP: cabeceras, cuerpos, fuente y estado |
| `Email Domain` | Dominio de envío |
| `Email Queue` | Cola de salida |
| `Email Template` | Plantilla reutilizable |
| `Email Settings` (Single) | Ajustes del hub |
| `Email Group` | Lista de destinatarios |
| `Communication` | Mensaje vinculado a un documento |
| `Auto Email Report` | Informe enviado por correo (módulo `Integrations`) |

## Printing — impresión

| DocType | Para qué |
|---|---|
| `Print Format` | Plantilla de un DocType: motor (`Jinja`/`Typst`), fuente, parámetros, datos de muestra y página |
| `Print Settings` (Single) | Fallback de página para los formatos |

## File — archivos

| DocType | Para qué |
|---|---|
| `File` | Metadatos de un fichero almacenado; el binario vive en el backend |

## Integrations — integraciones y automatización

| DocType | Para qué |
|---|---|
| `Webhook` | Envío HTTP ante eventos de documento |
| `OAuth Client` / `OAuth Provider` / `Connected App` / `Social Login Key` | OAuth saliente y SSO |
| `LDAP Settings` | Directorio LDAP |
| `Google Settings`, `Google Calendar`, `Google Contacts` | Integración con Google |
| `Push Notification` | Notificación in-app encolada, con reintentos y backoff |
| `Automation Flow` / `Automation Trigger Queue` | Automatización declarativa y su cola |
| `Reminder`, `Milestone`, `Assignment Rule`, `Auto Repeat` | Recordatorios, hitos y asignación/recurrencia automáticas |

## Website

| DocType | Para qué |
|---|---|
| `Website Settings` (Single) | Título, página de inicio y ajustes del sitio |
| `Website Theme`, `Website Script` | Tema y scripts del sitio |
| `Web Page`, `Web Form`, `Portal Settings` | Páginas, formularios y portal |

## System — operación

| DocType | Para qué |
|---|---|
| `System Settings` (Single) | Interruptores de instalación |
| `Error Log`, `API Request Log`, `View Log`, `Path Log` | Diagnóstico y trazas |
| `Version` | Historial de cambios de un documento (timeline) |
| `RQ Job`, `RQ Worker`, `Scheduled Job Type`, `Scheduled Job Log` | Cola y scheduler |
| `Prepared Report Analytics`, `Database Storage Usage By Tables`, `System Health Report` | Métricas de operación |

:::caution[El catálogo depende de las features]
`Email*` solo existe si se compiló `email`, `Print*` con `print`, y así con cada
vertical. Un DocType ausente en
`GET /api/doctype/meta/…` puede significar "feature apagada", no "no existe en
Ferris".
:::
