'use strict';

require('dotenv').config();
const http = require('node:http');

const { startWhatsApp } = require('./whatsapp');
const { createAiClient } = require('./ai');
const {
  initStore,
  getHistory,
  saveMessage,
  isDailyCapReached,
  incrementDailyUsage,
  isUserRateLimited,
} = require('./store');

const env = process.env;

const MAX_DAILY_API_CALLS = Number(env.MAX_DAILY_API_CALLS || 300);
const MAX_USER_MESSAGES_PER_HOUR = Number(env.MAX_USER_MESSAGES_PER_HOUR || 12);
const HISTORY_WINDOW = Number(env.HISTORY_WINDOW || 10);
const DB_PATH = env.DB_PATH || './data/virex-ai.db';
const BAILEYS_AUTH_PATH = env.BAILEYS_AUTH_PATH || './data/baileys-auth';

async function main() {
  if (!env.ANTHROPIC_API_KEY) {
    console.error('Falta ANTHROPIC_API_KEY en el entorno. El bot no puede arrancar.');
    process.exit(1);
  }

  const db = initStore(DB_PATH);
  const ai = createAiClient(env);

  async function onMessage(phone, text, sock) {
    // --- Tope diario global: se revisa ANTES de gastar nada ---
    if (isDailyCapReached(db, MAX_DAILY_API_CALLS)) {
      console.warn(`Tope diario de ${MAX_DAILY_API_CALLS} llamadas alcanzado. Ignorando mensaje de ${phone}.`);
      await sock.sendMessage(phone, {
        text: 'Estamos con mucha demanda en este momento — te escribimos apenas podamos retomar. Gracias por tu paciencia 🙏',
      });
      return;
    }

    // --- Límite por usuario: evita que una sola persona (o un bug) drene el presupuesto ---
    if (isUserRateLimited(db, phone, MAX_USER_MESSAGES_PER_HOUR)) {
      console.warn(`Usuario ${phone} superó el límite de ${MAX_USER_MESSAGES_PER_HOUR} msg/hora.`);
      await sock.sendMessage(phone, {
        text: 'Vamos con calma un momento 🙂 Te respondo en un rato, dame unos minutos.',
      });
      return;
    }

    const history = getHistory(db, phone, HISTORY_WINDOW);

    let answer;
    try {
      answer = await ai.reply(history, text);
    } catch (err) {
      console.error('Error llamando a Claude:', err);
      answer = 'Se me cruzaron los cables un segundo — ¿me lo puedes repetir?';
    }

    incrementDailyUsage(db);
    saveMessage(db, phone, 'user', text);
    saveMessage(db, phone, 'assistant', answer);

    await sock.sendMessage(phone, { text: answer });
  }

  await startWhatsApp(BAILEYS_AUTH_PATH, onMessage);

  // --- Servidor HTTP mínimo: Render necesita un puerto abierto para el healthcheck ---
  const port = env.PORT || 3000;
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('IA VIREX activa.');
    })
    .listen(port, () => console.log(`Healthcheck escuchando en :${port}`));
}

main().catch((err) => {
  console.error('Error fatal al arrancar IA VIREX:', err);
  process.exit(1);
});
