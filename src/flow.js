'use strict';

/**
 * Guion de bienvenida: menú de 4 opciones + respuesta fija por opción. Es
 * determinista a propósito: no gasta llamadas a la IA y el texto sale
 * siempre igual. (El video corto de bienvenida se manda aparte, en el
 * primer contacto, desde index.js.)
 *
 * Todo el guion tutea al cliente ("tú", nunca "usted"): Paola habla igual en
 * el menú, en la oferta, en los seguimientos y cuando responde la IA.
 *
 * Los textos NO prometen efectos médicos ni sexuales (próstata, erección,
 * duración, control urinario): eso va contra el límite de compliance del
 * prompt y contra las políticas de anuncios de salud de Meta. Si se cambian,
 * respeta ese límite.
 */

const MENU_MARKER = '¿Cuál de estas opciones';

const MENU_TEXT = `¡Hola! 😊 Qué gusto saludarte. Soy Paola, tu asesora de VIREX EVOLUTION.

Cuéntame, ¿qué te gustaría mejorar?

1️⃣ Energía y vitalidad
2️⃣ Confianza y rendimiento diario
3️⃣ Bienestar masculino en general
4️⃣ Todas las anteriores

${MENU_MARKER} se ajusta más a lo que necesitas?`;

const DISCLAIMER = 'ℹ️ Es un suplemento alimenticio y no reemplaza ningún tratamiento médico.';

const OPTION_REPLIES = {
  1: `¡Perfecto! 😊 Sabemos lo importante que es sentirse con energía todos los días.

⚡ Pensado para apoyar tu energía y vitalidad diaria.
🌿 Fórmula con ingredientes como maca, guaraná y açaí.
✅ Para incorporarlo de forma constante a tu rutina.

${DISCLAIMER}`,
  2: `¡Excelente! 😊 Sabemos lo importante que es sentirse con confianza y seguridad en el día a día.

💪 Pensado para acompañar tu vitalidad y tu sensación de fuerza.
🔥 Apoyo para tu rendimiento general dentro de una rutina diaria.
✅ Para usar de forma constante, como parte de tus hábitos.

${DISCLAIMER}`,
  3: `¡Perfecto! 😊 Cuidar tu bienestar masculino es una muy buena decisión.

🌿 Fórmula con zinc, vitamina D3, licopeno y cranberry.
💪 Pensado para acompañar tu vitalidad y tu energía.
✅ Para usar a diario como parte de tu rutina.

${DISCLAIMER}`,
  4: `¡Excelente! 😊 Sabemos lo importante que es cuidar tu bienestar masculino día a día.

⚡ Apoyo para tu energía y vitalidad.
💪 Acompañamiento para tu confianza y rendimiento general.
🌿 Fórmula con maca, guaraná, açaí, zinc, vitamina D3, licopeno y cranberry.

${DISCLAIMER}`,
};

const FOLLOWUP = '¿Te cuento cómo se usa y los precios?';

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
 * Precios: cuando el cliente pide el precio se manda la imagen de la oferta
 * (src/assets/oferta-virex.jpg) en vez de escribir los tres precios, y debajo
 * va UNA recomendación (el pack de 3 frascos) con opciones 1/2/3 para que el
 * cliente solo tenga que responder un número — una pregunta abierta ("¿cuál
 * te interesa?") enfría la venta justo después de ver el precio.
 *
 * Dos caminos hacia la misma imagen:
 *  1. Determinista: el mensaje pide precio (wantsPrice) → imagen sin gastar IA.
 *  2. La IA escribe PRICE_MARKER cuando iba a dar los precios (p. ej. el
 *     cliente dijo "sí" a "¿te cuento los precios?") → splitPriceMarker.
 */
const PRICE_MARKER = '[[PRECIOS]]';
const PRICE_IMAGE_NOTE = '[Imagen de la oferta enviada con los precios de 1, 2 y 3 frascos]';

/** "$130.000" → 130000; null si no se puede leer. */
function parseCop(value) {
  const n = Number(String(value || '').replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatCop(n) {
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/**
 * Cuánto sale cada frasco en el pack de 3 y cuánto se ahorra frente a comprar
 * 3 sueltos. Sale de los precios del entorno para no quedar desactualizado.
 * @returns {{perBottle:string, saving:string}|null}
 */
function computeOffer(price1, price3) {
  const p1 = parseCop(price1);
  const p3 = parseCop(price3);
  if (!p1 || !p3 || p1 * 3 <= p3) return null;
  return { perBottle: formatCop(p3 / 3), saving: formatCop(p1 * 3 - p3) };
}

/** Texto que acompaña la imagen de la oferta: recomienda el pack de 3 y pide solo un número. */
function buildPriceCaption({ price1, price3, gift }) {
  const offer = computeOffer(price1, price3);
  const detail = offer
    ? `cada uno te queda en ${offer.perBottle} (te ahorras ${offer.saving})`
    : 'cada frasco te sale más económico';
  return `Te recomiendo el de 3 frascos: te alcanza para unos 3 meses y ${detail} 💪
Y con cualquier compra te llega ${gift ? `de obsequio ${gift} 🎁` : 'un obsequio 🎁'}, envío gratis y pagas al recibir en tu casa 🚚

¿Cuál te separo? Respóndeme solo con el número 👇
1️⃣ 1 frasco
2️⃣ 2 frascos
3️⃣ 3 frascos (el más pedido ⭐)`;
}

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
function pickPriceImageReply(history, text, { hasPriceImage, caption }) {
  if (!hasPriceImage || !wantsPrice(text) || priceImageAlreadySent(history)) return null;
  return { caption };
}

/** Separa el marcador que escribe la IA del texto que sí se le muestra al cliente. */
function splitPriceMarker(answer) {
  const text = String(answer || '');
  if (!text.includes(PRICE_MARKER)) return { text: text.trim(), sendImage: false };
  return { text: text.split(PRICE_MARKER).join('').trim(), sendImage: true };
}

/** Respaldo en texto si la imagen no existe o WhatsApp no la pudo enviar. */
function buildPriceFallback({ price1, price2, price3, gift }) {
  return `Tenemos 1 frasco por ${price1}, 2 por ${price2} y el programa de 3 frascos por ${price3}.

${buildPriceCaption({ price1, price3, gift })}`;
}

/**
 * Elección de presentación: tras la oferta el cliente responde "3", "el de 2",
 * "quiero 1"... y se le piden los datos de envío de una vez. Cualquier otra
 * frase la maneja la IA (que tiene la misma instrucción en su prompt).
 * @returns {1|2|3|null}
 */
const BOTTLE_WORDS = { un: 1, uno: 1, dos: 2, tres: 3 };
const BOTTLE_CHOICE =
  /^(?:(?:quiero|dame|me\s+llevo|voy\s+con|sep[aá]ra(?:me)?|el\s+de|la\s+de|el|la)\s+)*(?:(?:la\s+)?opci[oó]n\s+)?(1|2|3|un|uno|dos|tres)(?:\s+frascos?)?\s*[.!)]*$/i;

function parseBottleChoice(text) {
  const t = String(text || '')
    .replace(/[⃣️]/g, '')
    .trim();
  const m = t.match(BOTTLE_CHOICE);
  if (!m) return null;
  const key = m[1].toLowerCase();
  return BOTTLE_WORDS[key] || Number(key);
}

/** La oferta (imagen) se mandó hace poco y el cliente contesta con la presentación que quiere. */
function pickOrderReply(history, text) {
  const offered = history.slice(-4).some((m) => m.role === 'assistant' && m.content.includes(PRICE_IMAGE_NOTE));
  if (!offered) return null;
  const bottles = parseBottleChoice(text);
  if (!bottles) return null;
  const label = bottles === 1 ? '1 frasco' : `${bottles} frascos`;
  return {
    bottles,
    text: `¡Excelente elección, ${label}! 🙌 Para programar tu envío, regálame: nombre completo, ciudad, dirección y un número de contacto 📦`,
  };
}

/** El cliente pide que no le escriban más: no se le mandan seguimientos. */
const OPT_OUT =
  /\b(no\s+(me\s+)?(interesa|gracias|quiero|escribas|escriban|molestes|molesten|insistas|insistan)|ya\s+no\s+(quiero|me\s+interesa)|d[eé]jame\s+(en\s+paz|tranquilo)|para\s+de\s+escribir|no\s+m[aá]s\s+mensajes|stop|elim[ií]name|b[oó]rrame)\b/i;

function isOptOut(text) {
  return OPT_OUT.test(String(text || ''));
}

/**
 * @param {{role:string, content:string}[]} history  Historial previo, sin el mensaje actual.
 * @param {string} text  Mensaje actual del cliente.
 * @returns {{text:string}|null}  null = que responda la IA.
 */
function pickScriptedReply(history, text) {
  if (history.length === 0 && wantsMenu(text)) {
    return { text: MENU_TEXT };
  }

  const last = history[history.length - 1];
  if (last && last.role === 'assistant' && last.content.includes(MENU_MARKER)) {
    const choice = normalizeChoice(text);
    if (choice) {
      return { text: `${OPTION_REPLIES[choice]}\n\n${FOLLOWUP}` };
    }
  }

  return null;
}

module.exports = {
  pickScriptedReply,
  normalizeChoice,
  wantsMenu,
  MENU_TEXT,
  PRICE_MARKER,
  PRICE_IMAGE_NOTE,
  computeOffer,
  buildPriceCaption,
  wantsPrice,
  pickPriceImageReply,
  splitPriceMarker,
  buildPriceFallback,
  parseBottleChoice,
  pickOrderReply,
  isOptOut,
};
