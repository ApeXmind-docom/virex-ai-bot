'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('./systemPrompt');

/**
 * Hora de Colombia para la regla de entrega inmediata (corte a las 2:00 p. m.):
 * el modelo no sabe qué hora es, así que se le dice en cada llamada.
 */
function colombiaClockSection(now = new Date()) {
  const parts = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const hour = Number(get('hour'));
  const cutoff = hour < 14 ? 'ANTES' : 'DESPUÉS';
  return `\n\n# HORA ACTUAL\nAhora son las ${get('hour')}:${get('minute')} del ${get('weekday')} en Colombia: es ${cutoff} de las 2:00 p. m. ` +
    `Úsalo solo para la regla de entrega inmediata de ENTREGAS.`;
}

function createAiClient(env, { hasPriceImage = false, priceCaptionOn = false } = {}) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const systemPrompt = buildSystemPrompt({
    hasPriceImage,
    priceCaptionOn,
    dosisConfirmada: env.DOSIS_CONFIRMADA === 'true',
    dosisTexto: env.DOSIS_TEXTO || '2 cápsulas al día',
    productUrl: env.PRODUCT_URL || '',
    referralDiscount: env.REFERRAL_DISCOUNT || '20%',
    referralCount: env.REFERRAL_COUNT || '3',
    price1: env.PRICE_1_BOTTLE || '$130.000',
    price2: env.PRICE_2_BOTTLES || '$230.000',
    price3: env.PRICE_3_BOTTLES || '$300.000',
    deliveryDaysOther: env.DELIVERY_DAYS_OTHER_CITIES || '',
    gift: env.GIFT_TEXT === undefined ? 'una crema Rhyno' : env.GIFT_TEXT,
    giftDetail: env.GIFT_DETAIL || 'es una crema retardante',
  });

  /**
   * @param {{role:'user'|'assistant', content:string}[]} history
   * @param {string} userMessage
   * @returns {Promise<string>}
   */
  async function reply(history, userMessage) {
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];
    // La ventana de historial puede arrancar en un mensaje de Paola (por ejemplo,
    // tras varios seguimientos seguidos); la API exige empezar por el cliente.
    while (messages.length > 1 && messages[0].role === 'assistant') messages.shift();

    const response = await client.messages.create({
      model: env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: Number(env.MAX_OUTPUT_TOKENS || 280),
      system: systemPrompt + colombiaClockSection(),
      messages,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text.trim() : 'Dame un momento y te respondo.';
  }

  return { reply };
}

module.exports = { createAiClient };
