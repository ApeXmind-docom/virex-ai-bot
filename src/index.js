'use strict';

require('dotenv').config();
const http = require('node:http');

const { startWhatsApp } = require('./whatsapp');
const { createAiClient } = require('./ai');
const { createTranscriber } = require('./transcribe');
const { renderPanel, renderLoginPage } = require('./admin');
const { createSession, isValidSession, destroySession, parseCookies, parseFormBody } = require('./sessions');
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
  const transcriber = createTranscriber(env);

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
        text: 'Estoy atendiendo a varias personas en este momento 😊 Dame unos minutos y sigo contigo.',
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

  await startWhatsApp(BAILEYS_AUTH_PATH, onMessage, transcriber);

  // --- Servidor HTTP: healthcheck de Render + panel de administración ---
  const port = env.PORT || 3000;
  const adminUsername = env.ADMIN_USERNAME || 'admin';
  const adminPassword = env.ADMIN_PASSWORD || '';
  const isProd = env.NODE_ENV === 'production' || !!env.RENDER;
  const SESSION_COOKIE = 'virex_session';

  if (!adminPassword) {
    console.warn(
      'AVISO: no hay ADMIN_PASSWORD configurada — el panel de administración quedará inaccesible hasta que la agregues.'
    );
  }

  function hasValidSession(req) {
    const cookies = parseCookies(req);
    return isValidSession(cookies[SESSION_COOKIE]);
  }

  function setSessionCookie(res, token) {
    const parts = [
      `${SESSION_COOKIE}=${token}`,
      'HttpOnly',
      'Path=/',
      'Max-Age=604800', // 7 días
      'SameSite=Lax',
    ];
    if (isProd) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  }

  http
    .createServer(async (req, res) => {
      const path = req.url.split('?')[0];

      // Ruta liviana y sin contraseña para que Render pueda confirmar que
      // el servicio sigue vivo, sin depender del login.
      if (path === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      // Compatibilidad con el link viejo que usaba ?key=... en la URL.
      if (path === '/admin') {
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
      }

      if (path === '/login' && req.method === 'POST') {
        const { username, password } = await parseFormBody(req);
        if (username === adminUsername && password === adminPassword && adminPassword) {
          const token = createSession();
          setSessionCookie(res, token);
          res.writeHead(302, { Location: '/' });
          res.end();
        } else {
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderLoginPage({ error: true }));
        }
        return;
      }

      if (path === '/logout' && req.method === 'POST') {
        const cookies = parseCookies(req);
        if (cookies[SESSION_COOKIE]) destroySession(cookies[SESSION_COOKIE]);
        clearSessionCookie(res);
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
      }

      if (path === '/login') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderLoginPage());
        return;
      }

      if (path === '/') {
        if (!hasValidSession(req)) {
          res.writeHead(302, { Location: '/login' });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderPanel(db, env, req));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No encontrado.');
    })
    .listen(port, () => console.log(`Servidor escuchando en :${port} (panel en la raíz /, login en /login)`));
}

main().catch((err) => {
  console.error('Error fatal al arrancar IA VIREX:', err);
  process.exit(1);
});
