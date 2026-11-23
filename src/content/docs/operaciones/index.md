---
title: Operaciones
description: Mapa de despliegue de Ferris y checklist mínima antes de poner una instalación en producción.
---

Esta sección cubre el ciclo de vida de una instalación: cómo se despliega, qué
hay que endurecer antes de abrirla, cómo se observa, cómo se protege y cómo se
restaura. No describe el desarrollo local; para eso están
[Instalación](/getting-started/instalacion/) y
[ferris dev](/cli/dev/).

## El mapa

```text
                 ┌──────────────────────────────┐
  navegador ───► │ reverse proxy (TLS, HTTP/2)   │
                 └──────────────┬───────────────┘
                                │  /  /api  /socket.io  /events
                 ┌──────────────▼───────────────┐
                 │ proceso `ferris serve`        │
                 │  api + web + realtime         │
                 └───┬───────────┬───────────┬──┘
                     │           │           │
              ┌──────▼───┐ ┌─────▼────┐ ┌────▼─────┐
              │PostgreSQL│ │  Redis   │ │ ficheros │
              │/MySQL/   │ │(opcional)│ │ locales  │
              │SQLite    │ └──────────┘ │ u objeto │
              └──────────┘              └──────────┘
```

Ferris es un proceso único que puede servir API, Desk, realtime, colas y
scheduler a la vez. También puede separarse por roles: un proceso `api,web` y
otro `worker,scheduler` contra la misma base de datos.

| Pieza | ¿Obligatoria? | Notas |
|---|---|---|
| Base de datos | Sí | SQLite, PostgreSQL o MySQL. |
| Redis | No | Si falta, la cola cae a la base de datos. |
| Ficheros | Sí, para adjuntos | Store local u objeto. |
| Reverse proxy | Recomendado | TLS, compresión, límites y logs de borde. |

## Antes de desplegar

1. **Fija la versión.** Ferris `0.4.0` es pre-1.0: hasta `1.0.0` una minor
   puede cambiar la API o el contrato WIT. Fija un tag o un commit; la política
   está en [Versionado](/referencia/versionado/).
2. **Elige las features.** `--features full` para todo, o una build mínima con
   `[features]` coherente. La configuración que pide algo no compilado no
   arranca.
3. **Decide el motor.** SQLite para una instalación pequeña y un solo proceso;
   PostgreSQL o MySQL para concurrencia, backups en caliente y varias instancias.
4. **Genera el secreto JWT.** Al menos 32 caracteres, fuera del repositorio.
5. **Configura TLS.** En el proceso (`[server.tls]`) o en el proxy, con
   `external_url` correcto.
6. **Migra antes de servir.** `ferris migrate` es un paso de despliegue, no algo
   que el arranque haga por ti.
7. **Comprueba.** `ferris doctor` y `GET /health` antes de abrir el tráfico.

## Checklist de producción

- [ ] `FERRIS_JWT_SECRET` de 32+ caracteres, inyectado por entorno.
- [ ] `[secrets] key` (o `FERRIS_SECRET_KEY`) configurada y respaldada aparte.
- [ ] `[database] ssl_mode = "verify-full"` si la base no está en el mismo host.
- [ ] `[server] external_url` con el origen público real.
- [ ] TLS en el proceso o terminado en el proxy, y decidido dónde.
- [ ] `enable_cors = false` salvo que otro origen lo necesite; entonces, lista
      explícita sin `*`.
- [ ] `body_limit_mb` y `request_timeout_secs` ajustados a la carga real.
- [ ] Roles separados si el scheduler o los workers compiten con la API.
- [ ] `ferris migrate` ejecutado y verificado con `--dry-run`.
- [ ] Backup de base de datos, ficheros y `<wasm_dir>/<app>/` probado.
- [ ] Clave de `[secrets]` guardada fuera del backup de la base.
- [ ] `ferris doctor` sin checks críticos en rojo.
- [ ] `/health` monitorizado y logs recolectados.
- [ ] Límites de conexiones del pool por debajo del máximo del motor.

```bash
ferris migrate --dry-run   # revisa lo pendiente
ferris migrate             # aplica tablas y mundos de plugins
ferris doctor              # checks críticos antes de abrir tráfico
```

## Qué no trae Ferris

Para no buscar lo que no existe:

- **No hay métricas Prometheus** ni endpoint `/metrics`.
- **No hay readiness probe** separada; `/health` solo dice que el proceso
  responde.
- **No hay rate limiting global**; solo el bloqueo de login por usuario.
- **No hay backup automático** ni retención programada.
- **No hay rollback de migraciones** desde el CLI.
- **No hay orquestación multi-tenant por host** en el servidor; el gestor de
  tenants y `ferris tenant` existen, pero un proceso sirve una base de datos.

## Siguiente paso

- [Despliegue](/operaciones/despliegue/): targets, Docker, Kubernetes y proxy.
- [Producción](/operaciones/produccion/): build, límites y actualización.
- [Seguridad](/operaciones/seguridad/): sesiones, CSP, sandbox y mTLS.
- [Observabilidad](/operaciones/observabilidad/): logs y diagnóstico.
- [Backup y migraciones](/operaciones/backup-y-migraciones/): restauración y
  orden correcto.
