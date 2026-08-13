'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('./systemPrompt');

function createAiClient(env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const systemPrompt = buildSystemPrompt({
    dosisConfirmada: env.DOSIS_CONFIRMADA === 'true',
    dosisTexto: env.DOSIS_TEXTO || '2 cápsulas al día',
    productUrl: env.PRODUCT_URL || '',
    referralDiscount: env.REFERRAL_DISCOUNT || '15%',
    price1: env.PRICE_1_BOTTLE || '$130.000',
    price2: env.PRICE_2_BOTTLES || '$230.000',
    price3: env.PRICE_3_BOTTLES || '$300.000',
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

    const response = await client.messages.create({
      model: env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: Number(env.MAX_OUTPUT_TOKENS || 280),
      system: systemPrompt,
      messages,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text.trim() : 'Dame un momento y te respondo.';
  }

  return { reply };
}

module.exports = { createAiClient };
