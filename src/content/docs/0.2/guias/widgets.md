---
title: Receta — widgets
description: Declarar un widget en describe(), darle parámetros y código,
  montarlo en un dashboard y depurar por qué no aparece.
slug: 0.2/guias/widgets
---

Un widget es una **definición reutilizable**; un dashboard tiene *instancias* de
ella. N instancias de `acme.ventas` montan N copias del mismo elemento con
parámetros distintos: eso es lo que hace que un widget sea reutilizable.

## 1. Declararlo

Un widget se declara en el `describe()` de la app y el host lo migra a la fila del
DocType `Widget` en la primera lectura del feed. A partir de ahí la fila manda: se
puede editar su etiqueta, sus parámetros o su JavaScript desde el Desk sin
recompilar la app.

```json
{
  "widgets": [{
    "name": "ventas-mes",
    "label": "Ventas del mes",
    "component": "ventas-mes",
    "type": "stat",
    "category": "Ventas",
    "icon": "📈",
    "version": "1",
    "params": [
      { "name": "doctype", "label": "DocType", "value-type": "doctype",
        "required": true },
      { "name": "moneda", "label": "Moneda", "value-type": "string",
        "default": "EUR", "options": ["EUR", "USD"] },
      { "name": "limite", "label": "Límite", "value-type": "number",
        "default": "30", "group": "Datos" }
    ],
    "size": { "span": 3, "rows": 2 },
    "min":  { "span": 2, "rows": 2 },
    "code_path": "ui/widgets/ventas.js",
    "script": "export default class extends HTMLElement { connectedCallback(){ /* … */ } }",
    "stylesheet": ":host { display: block; padding: 0; }"
  }]
}
```

Campos que importan:

| Campo | Efecto |
|---|---|
| `name` | id dentro de la app; la referencia global es `owner.name` |
| `component` | el host monta `<ferris-{component}>` |
| `type` | `stat`/`chart`/`table` deciden el span por defecto y el marco |
| `params` | lo que una instancia puede configurar |
| `size`/`min` | tamaño de partida y mínimo del builder |
| `requires` | permiso o capacidad para montarlo |
| `category` | grupo en la paleta |
| `preview` | imagen de la tarjeta del catálogo |
| `code_path` | ruta original del módulo, para que los `import` relativos resuelvan |
| `script`/`stylesheet`/`ssr` | fuente guardada en la fila del DocType |

:::note
`kind` es una cadena abierta. Un tipo que la app invente no falla: el Desk lo
enmarca como cuerpo genérico. Lo que no es abierto es el contrato del elemento,
que es el del punto 3.
:::

## 2. Parámetros

Los parámetros se editan con el **mismo** sistema de campos que un documento:
`WidgetParam` se traduce a `FormField`, así que `depends_on`, `read_only`,
`hidden` y `group` funcionan igual en el panel de propiedades que en un formulario.

Resolución de un valor, en orden:

1. el valor de la instancia;
2. el `default` de la definición;
3. el fallback del renderer (`number_param` cae a un número por defecto).

El host solo transporta **cadenas**; cada widget convierte según `value-type`.
Un `doctype` obligatorio que falta no se adivina: el cuerpo muestra qué parámetro
falta y el resto del tablero sigue pintando.

## 3. El elemento

El contrato es pequeño y estable:

* el host monta `<ferris-{component}>` dentro de la tarjeta;
* recibe `data-params` (JSON de pares), `data-label`, `data-widget` (la
  referencia) y `data-instance`;
* el CSS de la definición se aplica **dentro del shadow root**;
* el widget aporta solo el **cuerpo**: el marco, el padding, el borde y el título
  son de la tarjeta. Si pintas tu propia card, tendrás dos.

```js
export default class extends HTMLElement {
  connectedCallback() {
    const params = JSON.parse(this.getAttribute('data-params') || '[]');
    const mapa = Object.fromEntries(params);
    this.attachShadow({ mode: 'open' }).innerHTML =
      `<span class="valor">${this.getAttribute('data-label') ?? ''}</span>`;
    this.dataset.moneda = mapa.moneda ?? 'EUR';
  }
}
```

Si el widget necesita datos del motor, pídelos por la API con la sesión del
usuario; el host no le pasa un cliente privilegiado. Y si depende de una capacidad
opcional, comprueba `platform::features()` antes de mostrar el control.

## 4. Montarlo

En un dashboard, una instancia es una referencia más sus parámetros:

```json
{
  "id": "ventas-abril",
  "widget": "acme.ventas-mes",
  "label": "Abril",
  "params": [["doctype", "Sales Invoice"], ["moneda", "EUR"]],
  "span": 3,
  "rows": 2
}
```

Se añade desde la paleta del builder (`category` agrupa), o se escribe a mano en la
tabla `Dashboard Widget`. El `id` debe ser único dentro del dashboard; si falta, el
feed usa `row-{idx}`.

La misma definición puede aparecer en varios dashboards y varias veces en uno: cada
instancia tiene su propio `id`, sus parámetros y su estilo.

## 5. Estilos

Tres niveles y solo tres: la definición declara un `style` por defecto, la
instancia lo superpone campo a campo, y el tema del Desk pone la base. Un token
semántico (`"card"`, `"muted"`) se convierte en `var(--token)`; un color libre se
valida antes de escribirse en el `style` de la tarjeta. Nada de `style=` desde el
widget: si quieres una superficie, declárala en `style` de la definición.

## 6. Depuración

Si un widget no aparece, el orden de sospecha es:

1. **No está en el feed.** `/api/ui-extensions` es la fuente. Un `Widget` con
   `enabled = 0` se guarda pero se cae del feed; borrar una fila sembrada solo
   hace que la próxima migración la recree.
2. **La referencia no resuelve.** `host.stat` existe; `acme.ventas` necesita que la
   app esté cargada. El marcador discontinuo con la referencia es exactamente eso.
3. **Falta un parámetro obligatorio.** El cuerpo lo dice por su nombre.
4. **El módulo no carga o el elemento no se define.** Revisa la consola: un 404 en
   el script o un `customElements.define` con otro nombre deja el ancla vacía.
5. **El elemento se define tarde.** El montaje ocurre en un efecto; si el módulo
   registra el elemento de forma asíncrona, espera a tenerlo definido antes de
   montar.
6. **SSR.** El HTML del servidor solo trae el marcador. Si el widget aparece y
   desaparece, es hidratación, no render.

```bash
# El feed que ve el Desk
curl -s localhost:8000/api/ui-extensions | jq '.apps[].widgets[].name'

# La definición concreta
curl -s localhost:8000/api/widgets/acme/ventas-mes/script.js | head
```

## Límites

* El widget corre en el navegador con la sesión del usuario: no es un lugar para
  lógica privilegiada ni para secretos.
* Los datos que pinta deben venir de la API; no leas el DOM de otras tarjetas.
* La tarjeta manda en el tamaño: no asumas un ancho fijo, porque el builder cambia
  `span` y `rows`.
* Un `requires` no satisfecho no es un error de la app: es una instancia que no se
  monta.

Ver [Dashboards y widgets](/0.2/frontend/dashboards-y-widgets/) y
[UI extensions](/0.2/apps/ui-extensions/).
