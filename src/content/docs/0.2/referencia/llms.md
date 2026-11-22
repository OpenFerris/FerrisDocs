---
title: Documentación para LLMs
description: Índice llms.txt, versión completa y Markdown crudo de cada página
  para agentes y modelos.
slug: 0.2/referencia/llms
---

El sitio publica tres vistas pensadas para agentes y modelos de lenguaje. No
requieren autenticación y se generan en el build junto al HTML.

| Ruta | Contenido | `Content-Type` |
|---|---|---|
| `/llms.txt` | índice de páginas con título, descripción y enlace al Markdown | `text/plain` |
| `/llms-full.txt` | todas las páginas concatenadas, con un comentario `<!-- page: slug -->` por página | `text/plain` |
| `/<slug>.md` | Markdown crudo de una página | `text/markdown` |

## Índice

```bash
curl -s http://localhost:4321/llms.txt | head -40
```

El formato sigue la convención de `llms.txt`: un `# Ferris`, una cita con el
resumen y secciones con una lista de enlaces. Si el sitio tiene `site`
configurado, los enlaces son absolutos; si no, son rutas del mismo host.

## Página individual

```bash
curl -s http://localhost:4321/apps/wit.md | head -40
curl -s http://localhost:4321/getting-started/instalacion.md
```

El cuerpo es el Markdown fuente (sin frontmatter), precedido por el `title` y la
`description` de la página. Es la forma recomendada para que un agente lea solo
lo que necesita en vez de descargar el sitio entero.

## Contexto completo

```bash
curl -s http://localhost:4321/llms-full.txt > ferris-docs.md
```

Úsalo cuando el agente necesite el corpus completo. Para un contexto acotado,
prefiere `/llms.txt` y luego las páginas `.md` relevantes: el índice incluye la
descripción de cada página, que suele bastar para elegir.

## Convenciones

* Las rutas son las mismas que las del sitio, sin `.html`: `/conceptos/naming.md`
  corresponde a `/conceptos/naming/`.
* El índice raíz se sirve como `/index.md`.
* El Markdown no incluye componentes de UI ni HTML renderizado; es el texto que
  escribió el autor.
* La documentación de apps (`/apps/…`) es independiente del framework: un agente
  que solo implementa un componente no necesita leer `/arquitectura/`.
* El índice y el corpus completo excluyen las copias archivadas (`/0.2/…`).
  Para una versión concreta, pide su `.md` directamente
  (`/0.2/apps/wit.md`).

## Añadir una página

Cualquier página nueva bajo `src/content/docs` aparece automáticamente en los
tres endpoints: no hay una lista que mantener. Solo hay que enlazarla en el
sidebar para que también sea navegable por humanos.
