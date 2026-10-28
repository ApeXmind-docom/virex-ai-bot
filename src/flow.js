'use strict';

/**
 * Guion de bienvenida: menú de 4 opciones + respuesta fija por opción (con
 * video opcional). Es determinista a propósito: no gasta llamadas a la IA y
 * el texto sale siempre igual.
 *
 * Los textos NO prometen efectos médicos ni sexuales (próstata, erección,
 * duración, control urinario): eso va contra el límite de compliance del
 * prompt y contra las políticas de anuncios de salud de Meta. Si se cambian,
 * respeta ese límite.
 */

const MENU_MARKER = '¿Cuál de estas opciones';

const MENU_TEXT = `¡Hola! 😊 Qué gusto saludarle. Soy Paola, su asesora de VIREX EVOLUTION.

Cuénteme, ¿qué le gustaría mejorar?

1️⃣ Energía y vitalidad
2️⃣ Confianza y rendimiento diario
3️⃣ Bienestar masculino en general
4️⃣ Todas las anteriores

${MENU_MARKER} se ajusta más a lo que necesita?`;

const DISCLAIMER = 'ℹ️ Es un suplemento alimenticio y no reemplaza ningún tratamiento médico.';

const OPTION_REPLIES = {
  1: `¡Perfecto! 😊 Sabemos lo importante que es sentirse con energía todos los días.

⚡ Pensado para apoyar su energía y vitalidad diaria.
🌿 Fórmula con ingredientes como maca, guaraná y açaí.
✅ Para incorporarlo de forma constante a su rutina.

${DISCLAIMER}`,
  2: `¡Excelente! 😊 Sabemos lo importante que es sentirse con confianza y seguridad en el día a día.

💪 Pensado para acompañar su vitalidad y su sensación de fuerza.
🔥 Apoyo para su rendimiento general dentro de una rutina diaria.
✅ Para usar de forma constante, como parte de sus hábitos.

${DISCLAIMER}`,
  3: `¡Perfecto! 😊 Cuidar su bienestar masculino es una muy buena decisión.

🌿 Fórmula con zinc, vitamina D3, licopeno y cranberry.
💪 Pensado para acompañar su vitalidad y su energía.
✅ Para usar a diario como parte de su rutina.

${DISCLAIMER}`,
  4: `¡Excelente! 😊 Sabemos lo importante que es cuidar su bienestar masculino día a día.

⚡ Apoyo para su energía y vitalidad.
💪 Acompañamiento para su confianza y rendimiento general.
🌿 Fórmula con maca, guaraná, açaí, zinc, vitamina D3, licopeno y cranberry.

${DISCLAIMER}`,
};

const VIDEO_CAPTION =
  '🎥 Le comparto un video para que conozca mejor VIREX Evolution. Cuando lo vea, ¿le cuento cómo se usa y los precios?';
const NO_VIDEO_FOLLOWUP = '¿Le cuento cómo se usa y los precios?';

const BUY_INTENT = /(compr|pedir|pedido|kiero|quiero (el|los|las|un|una|uno|1|2|3)|precio|cu[aá]nto|cuesta|contra ?entrega)/i;
const GREETING = /\b(hola|buen[oa]s|info|informaci[oó]n|me interesa|cu[eé]ntame|saludos|ola)/i;
const WORD_NUMBERS = { uno: 1, dos: 2, tres: 3, cuatro: 4 };

function wantsMenu(text) {
  const t = String(text || '').trim();
  return t.length > 0 && t.length <= 60 && GREETING.test(t) && !BUY_INTENT.test(t);
}

function normalizeChoice(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[⃣️]/g, '')
    .trim();
  const m = t.match(/^(?:la\s+)?(?:opci[oó]n\s*(?:n[uú]mero\s*)?)?([1-4]|uno|dos|tres|cuatro)\s*[.)!]*$/);
  if (m) return WORD_NUMBERS[m[1]] || Number(m[1]);
  if (/^todas(\s+las\s+anteriores)?\s*[.!]*$/.test(t)) return 4;
  return null;
}

/**
 * @param {{role:string, content:string}[]} history  Historial previo, sin el mensaje actual.
 * @param {string} text  Mensaje actual del cliente.
 * @param {{hasVideo:boolean}} opts
 * @returns {{text:string, videoCaption:string|null}|null}  null = que responda la IA.
 */
function pickScriptedReply(history, text, { hasVideo }) {
  if (history.length === 0 && wantsMenu(text)) {
    return { text: MENU_TEXT, videoCaption: null };
  }

  const last = history[history.length - 1];
  if (last && last.role === 'assistant' && last.content.includes(MENU_MARKER)) {
    const choice = normalizeChoice(text);
    if (choice) {
      return hasVideo
        ? { text: OPTION_REPLIES[choice], videoCaption: VIDEO_CAPTION }
        : { text: `${OPTION_REPLIES[choice]}\n\n${NO_VIDEO_FOLLOWUP}`, videoCaption: null };
    }
  }

  return null;
}

/**
 * Precios: cuando el cliente pide el precio se manda la imagen de la oferta
 * (src/assets/oferta-virex.jpg) en vez de escribir los tres precios.
 *
 * Dos caminos hacia la misma imagen:
 *  1. Determinista: el mensaje pide precio (wantsPrice) → imagen sin gastar IA.
 *  2. La IA escribe PRICE_MARKER cuando iba a dar los precios (p. ej. el
 *     cliente dijo "sí" a "¿le cuento los precios?") → splitPriceMarker.
 */
const PRICE_MARKER = '[[PRECIOS]]';
const PRICE_IMAGE_NOTE = '[Imagen de la oferta enviada con los precios de 1, 2 y 3 frascos]';
const PRICE_CAPTION =
  'Con gusto 😊 Aquí le comparto la oferta con los tres precios. El envío es gratis y puede pagar al recibir 🚚 ¿Cuál presentación le llama más la atención?';

const PRICE_ASK =
  /\b(precios?|cu[aá]nto\s+(cuesta|cuestan|vale|valen|sale|salen|cobran|es|me\s+cuesta)|valor(es)?|costo|cu[aá]nto\s+por)\b/i;
// "está caro", "hay descuento": es una objeción, no una petición de precio.
const PRICE_OBJECTION = /\b(caro|cara|costos[oa]|muy\s+alto|elevado|barato|rebaja|descuento)\b/i;
// Ya eligió presentación o quiere pedir: la compra tiene prioridad sobre la imagen.
const PRICE_CHOSEN =
  /\b(me\s+llevo|lo\s+compro|los\s+compro|voy\s+a\s+(pedir|comprar)|quiero\s+(pedir|comprar|hacer\s+(el|mi)\s+pedido)|c[oó]mo\s+(hago|pido|compro)|d[oó]nde\s+(lo\s+)?compro|quiero\s+(los\s+|las\s+)?(1|2|3|un|una|uno|dos|tres)\b)/i;

function wantsPrice(text) {
  const t = String(text || '');
  return PRICE_ASK.test(t) && !PRICE_OBJECTION.test(t) && !PRICE_CHOSEN.test(t);
}

/** True si en los últimos mensajes ya se mandó la imagen (para no repetirla). */
function priceImageAlreadySent(history) {
  return history.slice(-6).some((m) => m.role === 'assistant' && m.content.includes(PRICE_IMAGE_NOTE));
}

/**
 * @returns {{caption:string}|null}  null = no mandar la imagen.
 */
function pickPriceImageReply(history, text, { hasPriceImage }) {
  if (!hasPriceImage || !wantsPrice(text) || priceImageAlreadySent(history)) return null;
  return { caption: PRICE_CAPTION };
}

/** Separa el marcador que escribe la IA del texto que sí se le muestra al cliente. */
function splitPriceMarker(answer) {
  const text = String(answer || '');
  if (!text.includes(PRICE_MARKER)) return { text: text.trim(), sendImage: false };
  return { text: text.split(PRICE_MARKER).join('').trim(), sendImage: true };
}

/** Respaldo en texto si la imagen no existe o WhatsApp no la pudo enviar. */
function buildPriceFallback({ price1, price2, price3 }) {
  return `Tenemos 1 frasco por ${price1}, 2 por ${price2} y el programa de 3 frascos por ${price3}. El envío es gratis y puede pagar contra entrega 🚚 ¿Cuál presentación le llama más la atención?`;
}

module.exports = {
  pickScriptedReply,
  normalizeChoice,
  wantsMenu,
  MENU_TEXT,
  PRICE_MARKER,
  PRICE_IMAGE_NOTE,
  PRICE_CAPTION,
  wantsPrice,
  pickPriceImageReply,
  splitPriceMarker,
  buildPriceFallback,
};
