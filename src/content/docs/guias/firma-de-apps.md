---
title: Firma y grants de apps
description: Cómo se firma un paquete, cómo se verifica al instalar y qué grants tiene que aprobar el operador.
---

Un manifiesto **pide** capacidades; `grants.toml` es la **aprobación** del
operador. El host comprueba las dos cosas.

## Firmar

```bash
openssl genpkey -algorithm ED25519 -out publisher.pem
ferris app sign --app apps/billing --key publisher.pem
```

El comando escribe el `key_id` en `plugin.toml`, el hash SHA-256 de
`<app>.wasm` y `app.sig` junto al manifiesto. La firma es Ed25519 sobre los
bytes canónicos del manifiesto (campos ordenados y listas normalizadas), así que
reordenar un TOML no invalida la firma, pero cambiar un campo sí.

## Verificar e instalar

```bash
ferris app verify --app apps/billing --trust trusted-keys.toml
ferris app install apps/billing --trust trusted-keys.toml
```

`--trust` es un fichero TOML o JSON con las claves públicas de los publishers
(`[[keys]] key_id = "..." public_key = "<base64>"`). La instalación:

1. reconstruye el manifiesto desde disco y verifica el hash del wasm;
2. verifica `app.sig` contra la clave del `key_id`;
3. imprime publisher, versión y **todos** los grants pedidos;
4. exige `--yes` o uno o más `--grant <item>`;
5. solo entonces copia el paquete y escribe `grants.toml`.

Sin `app.sig`, la instalación falla salvo `--allow-unsigned`, que deja el
paquete sin atribución y sin grants aprobados. Un paquete firmado sin `--trust`
también falla: una firma que nadie verifica no es confianza.

Los grants son capacidades (`process`, `raw-sockets`, …), hosts HTTP
(`http:api.example.com`) y binarios de `process` (`process:bin/tool`).

## Qué aplica el host

- **Primordiales** (mundo, rutas, HTTP saliente, document store, config, schema,
  scheduler, notificaciones, pubsub): manda el manifiesto, como antes.
- **Específicas** (`process`, `http-unrestricted`, `tls-*`, `streams*`,
  `raw-sockets`, `udp`, `dns-server`, `pki`, `overrides`, `threads`): hacen
  falta el manifiesto **y** el grant aprobado.
- **HTTP saliente**: el host debe estar en el allow-list del manifiesto y en
  `approved.http_hosts`.
- **`process`**: allow-list de binarios, timeout, tope de salida y el grant
  aprobado; un `grants.toml` ausente deniega.

## Límites actuales

- La firma se comprueba al **instalar**, no en cada arranque.
- No hay revocación ni rotación de claves desde el Desk.
- Un paquete instalado con `--allow-unsigned` no pide grants y queda limitado a
  las capacidades primordiales y a lo que el operador le conceda después.
