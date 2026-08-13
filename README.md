# IA VIREX

Agente de WhatsApp para los leads que completan el Puntaje VIREX en la landing.
Misma arquitectura que NOVA, PABA AI y KAIA: Node.js + Baileys (WhatsApp) +
Claude Haiku (Anthropic) + SQLite (historial y controles de costo).

## Antes de desplegar — lee esto

Este bot **todavía no tiene la información final del producto confirmada**
(dosis exacta, certificaciones reales, enlace de compra). El `system prompt`
(`src/systemPrompt.js`) está escrito para ser honesto sobre eso en vez de
inventar datos. Antes de activarlo con tráfico real:

1. Confirma la dosis real con el fabricante y actualiza `DOSIS_CONFIRMADA=true`
   y `DOSIS_TEXTO` en las variables de entorno.
2. Cuando tengas el enlace de compra, ponlo en `PRODUCT_URL`.
3. **No agregues menciones de INVIMA/FDA/GMP al prompt** hasta tener el
   registro real a nombre de la empresa que va a vender el producto (ver la
   conversación sobre la etiqueta de "Prosvent" — ese problema se resuelve
   con el documento correcto, no editando el bot).

## Estructura

```
src/
  index.js          # punto de entrada: orquesta todo
  whatsapp.js        # conexión Baileys (QR, reconexión, mensajes entrantes)
  ai.js               # llamada a Claude Haiku
  systemPrompt.js     # reglas de compliance del bot — leer antes de tocar
  store.js            # SQLite: historial + límites de costo
```

## Desplegar en Render

### 1. Crear el servicio
- Render → New → **Background Worker** (no Web Service — no necesita tráfico HTTP entrante real, solo el healthcheck interno que ya incluye `index.js`).
- Conecta este repo.
- Build command: `npm install`
- Start command: `npm start`

### 2. Agregar un disco persistente
Esto es obligatorio — sin esto, la sesión de WhatsApp y el historial se
borran en cada redeploy y hay que volver a escanear el QR cada vez.

- Render → tu servicio → **Disks** → Add Disk
- Mount path: `/data`
- Tamaño: 1 GB es más que suficiente para empezar

### 3. Variables de entorno
Copia todo lo de `.env.example` a Render → Settings → Environment.
Como mínimo necesitas `ANTHROPIC_API_KEY` para que arranque.

### 4. Vincular el WhatsApp
- Al desplegar, revisa los **Logs** del servicio en Render.
- Va a aparecer un código QR en texto (ASCII) en los logs.
- Escanéalo desde el WhatsApp del número que quieres usar como IA VIREX
  (Configuración → Dispositivos vinculados → Vincular un dispositivo).
- Una vez vinculado, la sesión queda guardada en el disco — no hay que
  repetir esto en cada redeploy.

### 5. Probarlo
Manda un mensaje de prueba al número vinculado. Si todo está bien
configurado, deberías ver en los logs: `✓ IA VIREX conectada a WhatsApp`,
y el bot debería responder en segundos.

## Controles de costo (no los quites)

Esto existe porque ya pasó antes con otro bot: un bug o un usuario
insistente puede generar un consumo de API descontrolado si no hay topes.

- `MAX_DAILY_API_CALLS` — tope global de llamadas a Claude por día.
- `MAX_USER_MESSAGES_PER_HOUR` — tope por número de WhatsApp.
- `MAX_OUTPUT_TOKENS` — limita el tamaño de cada respuesta.

Si el bot empieza a recibir tráfico real de la campaña, vigila los logs
los primeros días para calibrar estos números — 300 llamadas/día es un
punto de partida conservador, no un número mágico.

## Qué falta (deliberadamente, hasta que llegue la info real)

- [ ] Confirmar dosis real y actualizar `DOSIS_CONFIRMADA`
- [ ] Enlace de compra (`PRODUCT_URL`)
- [ ] Certificaciones reales (INVIMA a nombre de la empresa correcta — no Prosvent)
- [ ] Nombre final del producto: confirmar si es VIREX o Birex antes de producción
