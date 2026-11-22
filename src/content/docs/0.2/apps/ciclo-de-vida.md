---
title: Ciclo de vida
description: Los 19 puntos del contrato, cuáles emite el host, el orden por
  operación, cuáles abortan la escritura y cómo evitarlo con write-disposition.
slug: 0.2/apps/ciclo-de-vida
---

Cuando un documento cambia, el host recorre sus puntos de ciclo de vida y
reenvía cada punto emitido a la app que declaró ese DocType:

```wit
export doctype-event: func(
    event: string,
    doctype: string,
    name: string,
    data: string,
) -> result<_, error>;
```

`data` es el documento en JSON canónico (claves ordenadas), la misma forma que
devuelve `data::get-docs`. `name` puede ser la cadena vacía en los puntos
anteriores al naming.

## Los 19 eventos

| `event` | ¿Aborta la escritura? | ¿Lo emite el host? |
|---|---|---|
| `before-naming` | sí | sí |
| `before-validate` | sí | sí |
| `validate` | sí | sí |
| `before-insert` | sí | sí |
| `created` | no | sí |
| `before-save` | sí | sí |
| `after-save` | no | sí |
| `on-update` | no | sí |
| `before-submit` | sí | sí |
| `submitted` | no | sí |
| `before-cancel` | sí | sí |
| `cancelled` | no | sí |
| `before-update-after-submit` | sí | sí |
| `on-update-after-submit` | no | sí |
| `on-change` | no | sí |
| `before-delete` | sí | sí |
| `trashed` | no | sí |
| `before-rename` | sí | sí |
| `after-rename` | no | sí |

## Orden por operación

```text
insert  before-naming → before-validate → validate → before-insert → created → on-update
update  before-validate → validate → before-save → before-update-after-submit
        → after-save → on-update → on-update-after-submit → on-change
submit  before-submit → submitted
cancel  before-cancel → cancelled
trash   before-delete → trashed
rename  before-rename → after-rename
amend   before-save → after-save
```

Dos consecuencias que suelen sorprender:

* **Un `create` no emite `after-save`.** Recorre sus puntos previos, luego
  `created` y `on-update`.
* **Un `update` no emite `created`.** Emite `after-save` y `on-update`, y si el
  documento estaba enviado, también `before-update-after-submit` y
  `on-update-after-submit`.

## Los `before-*` son síncronos

Los diez puntos que abortan (`before-naming`, `before-validate`, `validate`,
`before-insert`, `before-save`, `before-submit`, `before-cancel`,
`before-update-after-submit`, `before-delete`, `before-rename`)
se entregan **en línea**: tu app decide antes de que la fila se escriba.

Los demás observan una escritura que ya ocurrió. Si la instancia está ocupada, el
host los encola y los entrega cuando queda libre, para que una petición lenta no
pierda el `created`. La cola es acotada: si se llena, el host descarta el evento
más nuevo y lo registra en el log.

## Abortar una escritura

En un punto que aborta, devolver un `error` cancela la operación y el host
propaga el status del variante:

| Variante devuelto | Status |
|---|---|
| `validation-failed` | 422 |
| `permission-denied` | 403 |
| `not-found` | 404 |
| `conflict` | 409 |
| `rate-limited(segundos)` | 429 |
| `timeout` | 504 |
| `internal` | 500 |

```text
func doctype-event(event, doctype, name, data):
    if event == "validate" and doctype == "Nota":
        doc = parse_json(data)
        if trim(doc["titulo"]) == "":
            return error.validation-failed("el título es obligatorio")
    return ok
```

Un trap (excepción no capturada, plazo de CPU agotado) no es un `error`: es un
fallo del host y se reporta como 500 sin mensaje del guest. No uses excepciones
para validar.

## `write-disposition`: escribir sin reentrar

Una app que reacciona a su propio DocType y escribe en él se llamaría a sí misma.
`data::write` lleva la decisión explícita:

```wit
enum write-disposition {
    emit-events,  // valida y encola los puntos posteriores
    silent,       // persiste y sella, sin reentrar en los handlers de la app
}
```

```text
data::write-doc({
    kind: upsert,
    doctype: "Nota",
    name: none,
    data: json,
    disposition: silent,
})
```

`silent` no desactiva los eventos de otras apps ni los del host: solo evita que
**esta** app vuelva a entrar en su propio evento. Es la salida explícita del
bucle, no un atajo para saltarse la validación de otros.

## Cuando un `before-*` no puede ejecutarse

Si la escritura nace **dentro** de una llamada de tu propia app (por ejemplo, un
`data::write-doc` durante `handle-request`), la instancia única no puede
reentrar. El host **rechaza** la escritura con un `validation-failed` (422) que
nombra el punto que no pudo ejecutar y te recuerda la salida explícita:
`write-disposition: silent`.

La alternativa —dejar pasar la escritura sin la validación que la app declaró—
convertiría un bloqueo en corrupción silenciosa. Por eso el fallo es explícito y
nombra el opt-out.

:::caution[Un evento que no se puede entregar no se inventa]
Los puntos que abortan esperan o fallan; nunca se saltan. Los que observan se
encolan y, si el guest atrapa, se reintentan con una instancia nueva dentro de un
presupuesto pequeño. Pasado el presupuesto, el evento se descarta y queda en el
log con la app, el DocType y el nombre.
:::

## Qué no hacer

* No devuelvas éxito desde un validador que no valida: el host lo trata como
  aprobación.
* No uses `doctype-event` para trabajo largo. Encola un job con
  `platform::enqueue-job` y responde: el presupuesto de CPU por llamada es finito.
* No supongas que una clave ausente llega como `null`; ausente significa «no está
  en el documento».
* No escribas el mismo DocType desde su propio `after-save` con
  `emit-events`: usa `silent` o encola el trabajo.
