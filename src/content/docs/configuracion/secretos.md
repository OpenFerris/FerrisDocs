---
title: Secretos
description: Cifrado recuperable de los campos Secret — clave AEAD, rotación, variables de entorno y diagnóstico.
---

Los **campos `Secret`** guardan credenciales cifradas y recuperables dentro de la
base de datos, para que un conector, un webhook o un cliente SMTP puedan firmar o
autenticarse con el valor real sin exponerlo en cada lectura.

## Sección `[secrets]`

`[secrets]` instala la clave que cifra los campos de tipo `Secret`.

```toml
[secrets]
key = "64-caracteres-hex-o-base64-de-32-bytes"
previous_keys = []
```

| Clave | Notas |
|---|---|
| `key` | 32 bytes en 64 hex o base64 (URL-safe o estándar, con o sin padding). |
| `previous_keys` | Claves anteriores, aceptadas solo para descifrar. |

También se aceptan `FERRIS_SECRET_KEY` (o `FERRIS_SECRETS__KEY`) para la clave y
`FERRIS_SECRET_PREVIOUS_KEYS="clave-anterior-1,clave-anterior-2"` para las
anteriores.

### Cómo se guarda

AES-256-GCM con un nonce aleatorio de 96 bits por valor. El texto guardado es
un sobre versionado:

```text
ferris:v1:<key-id>:<payload-base64url>
```

El `key-id` son los primeros 8 caracteres hex de `SHA-256(clave)`. El DocType y
el nombre del campo se usan como **datos asociados**: copiar un cifrado a otro
campo o a otro DocType falla la autenticación en vez de descifrar en el sitio
equivocado.

Guardar dos veces el mismo secreto produce dos cifrados distintos. El nonce nunca
se reutiliza.

### `Password` frente a `Secret`

| Tipo de campo | Almacenamiento | Lectura normal |
|---|---|---|
| `Password` | Hash Argon2, unidireccional | `********` |
| `Secret` | AES-256-GCM, recuperable | `********` |

Un `Password` sirve para verificar un login: nunca devuelve el plaintext. Un
`Secret` sirve para un `client_secret` de OAuth, una clave de webhook o una
contraseña SMTP, donde el conector necesita el valor real para firmar o
autenticarse. Declarar esos campos como `Password` hace que toda integración lea
`"********"` y falle en silencio.

El secreto TOTP de MFA (`User.mfa_secret`) también es un `Secret`. Habilitar o
rotar MFA exige, por tanto, la clave `[secrets]`; sin ella la operación falla con
`KeyMissing` en vez de guardar el secreto en claro.

El plaintext de un `Secret` solo se entrega a un contexto de motor que llamó a
`reveal_secrets()`, y viaja envuelto en `SecretValue`, sin `Display` ni
`Serialize` y con `Debug` redactado.

### Rotación

1. Genera una clave nueva.
2. Ponla en `key` y mueve la anterior a `previous_keys`.
3. Arranca: los valores nuevos se cifran con la nueva; los anteriores se descifran
   con la que sigue instalada.
4. Reescribe las filas (guardar cada documento basta) y quita la clave anterior
   de `previous_keys`.

Un valor cuyo `key-id` ya no está instalado devuelve `UnknownKeyId`. Un valor
que no es un sobre v1 (por ejemplo, un hash Argon2 escrito cuando el campo era
`Password`) devuelve `NotRecoverable`. Ninguno se convierte en cadena vacía.

:::danger
Sin la clave, los campos `Secret` **no se pueden recuperar**. Guarda la clave
fuera del backup de la base de datos y del repositorio, y conserva las anteriores
mientras quede una sola fila sin reescribir.
:::

### Arranque y diagnóstico

- Una clave **malformada** es fatal: se detiene el arranque, porque nada escrito
  en esa ejecución podría descifrarse después.
- Una clave **ausente** no impide servir: se registra un aviso si el catálogo
  declara campos `Secret`; la primera escritura o revelación falla con
  `KeyMissing`.
- `ferris doctor` comprueba la clave y escanea los documentos almacenados en busca
  de campos `Secret` que aún no sean un sobre cifrado.

`ferris config show` imprime la clave como `<redacted>`, igual que los secretos de
proveedor, que también se enmascaran en `Debug` y en `ferris info`.
