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

module.exports = { pickScriptedReply, normalizeChoice, wantsMenu, MENU_TEXT };
