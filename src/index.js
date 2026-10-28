'use strict';

require('dotenv').config();
const fs = require('node:fs');
const http = require('node:http');
const nodePath = require('node:path');

const { startWhatsApp } = require('./whatsapp');
const { createAiClient } = require('./ai');
const { createTranscriber } = require('./transcribe');
const { waitLikeHuman } = require('./humanize');
const { acquireSingletonLock } = require('./singleton');
const {
  pickScriptedReply,
  pickPriceImageReply,
  splitPriceMarker,
  buildPriceFallback,
  PRICE_IMAGE_NOTE,
  PRICE_CAPTION,
} = require('./flow');
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
const PRICE_IMAGE_PATH = env.PRICE_IMAGE_PATH || nodePath.join(__dirname, 'assets', 'oferta-virex.jpg');
const WELCOME_VIDEO_PATH = nodePath.join(__dirname, 'assets', 'bienvenida.mp4');
const WELCOME_VIDEO_CAPTION = '🎥 Un video corto para que conozca VIREX Evolution 😊';

/**
 * Video corto del primer contacto: una URL pública (VIREX_VIDEO_URL) o el
 * archivo src/assets/bienvenida.mp4. null = no hay video y se omite.
 */
function resolveWelcomeVideo() {
  if (env.VIREX_VIDEO_URL) return { url: env.VIREX_VIDEO_URL };
  if (fs.existsSync(WELCOME_VIDEO_PATH)) return { url: WELCOME_VIDEO_PATH };
  return null;
}

/** Imagen de la oferta con los precios; null si no está (el bot cae a texto). */
function loadPriceImage() {
  try {
    return fs.readFileSync(PRICE_IMAGE_PATH);
  } catch (err) {
    console.warn(`No se pudo leer la imagen de precios (${PRICE_IMAGE_PATH}): ${err.message}. Se responderá con texto.`);
    return null;
  }
}

async function main() {
  if (!env.ANTHROPIC_API_KEY) {
    console.error('Falta ANTHROPIC_API_KEY en el entorno. El bot no puede arrancar.');
    process.exit(1);
  }

  const db = initStore(DB_PATH);
  const welcomeVideo = resolveWelcomeVideo();
  if (!welcomeVideo) {
    console.warn('Sin video de bienvenida (ni VIREX_VIDEO_URL ni src/assets/bienvenida.mp4): el primer contacto va solo con el saludo.');
  }
  const priceImage = loadPriceImage();
  const ai = createAiClient(env, { hasPriceImage: Boolean(priceImage) });
  const transcriber = createTranscriber(env);

  const priceFallback = buildPriceFallback({
    price1: env.PRICE_1_BOTTLE || '$130.000',
    price2: env.PRICE_2_BOTTLES || '$230.000',
    price3: env.PRICE_3_BOTTLES || '$300.000',
  });

  /** Manda la imagen de la oferta con el texto como pie; si falla, manda los precios en texto. */
  async function sendPriceImage(sock, phone, caption) {
    try {
      await sock.sendMessage(phone, { image: priceImage, caption });
    } catch (err) {
      console.error('No se pudo enviar la imagen de precios:', err.message);
      await sock.sendMessage(phone, { text: priceFallback });
    }
  }

  /** Video corto apenas la persona escribe por primera vez; si falla, el saludo sigue igual. */
  async function sendWelcomeVideo(sock, phone) {
    try {
      await sock.sendMessage(phone, { video: welcomeVideo, mimetype: 'video/mp4', caption: WELCOME_VIDEO_CAPTION });
    } catch (err) {
      console.error('No se pudo enviar el video de bienvenida:', err.message);
    }
  }

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

    // --- Primer contacto: el video sale de inmediato, antes de cualquier respuesta ---
    if (history.length === 0 && welcomeVideo) {
      await sendWelcomeVideo(sock, phone);
    }

    const scripted = pickScriptedReply(history, text);
    if (scripted) {
      saveMessage(db, phone, 'user', text);
      saveMessage(db, phone, 'assistant', scripted.text);
      await waitLikeHuman(sock, phone, scripted.text);
      await sock.sendMessage(phone, { text: scripted.text });
      return;
    }

    // --- Pidió precio: se manda la imagen de la oferta, sin gastar una llamada a la IA ---
    const priceReply = pickPriceImageReply(history, text, { hasPriceImage: Boolean(priceImage) });
    if (priceReply) {
      saveMessage(db, phone, 'user', text);
      saveMessage(db, phone, 'assistant', `${PRICE_IMAGE_NOTE}\n${priceReply.caption}`);
      await waitLikeHuman(sock, phone, priceReply.caption);
      await sendPriceImage(sock, phone, priceReply.caption);
      return;
    }

    let answer;
    try {
      answer = await ai.reply(history, text);
    } catch (err) {
      console.error('Error llamando a Claude:', err);
      answer = 'Se me cruzaron los cables un segundo — ¿me lo puedes repetir?';
    }

    // La IA escribe [[PRECIOS]] cuando iba a dar los precios: se manda la imagen en su lugar.
    const { text: cleanAnswer, sendImage } = splitPriceMarker(answer);

    incrementDailyUsage(db);
    saveMessage(db, phone, 'user', text);

    if (sendImage && priceImage) {
      const caption = cleanAnswer || PRICE_CAPTION;
      saveMessage(db, phone, 'assistant', `${PRICE_IMAGE_NOTE}\n${caption}`);
      await waitLikeHuman(sock, phone, caption);
      await sendPriceImage(sock, phone, caption);
      return;
    }

    const finalAnswer = cleanAnswer || (sendImage ? priceFallback : answer);
    saveMessage(db, phone, 'assistant', finalAnswer);
    await waitLikeHuman(sock, phone, finalAnswer);
    await sock.sendMessage(phone, { text: finalAnswer });
  }

  // Los clientes mandan ráfagas ("quiero el producto" + "mami"). Se esperan
  // unos segundos y se responde UNA vez a todo junto, en orden por teléfono.
  const DEBOUNCE_MS = Number(env.MESSAGE_DEBOUNCE_MS || 4000);
  const pendingByPhone = new Map();
  const inFlightByPhone = new Map();

  function enqueueMessage(phone, text, sock) {
    const entry = pendingByPhone.get(phone) || { texts: [] };
    entry.texts.push(text);
    entry.sock = sock;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      pendingByPhone.delete(phone);
      const joined = entry.texts.join('\n');
      const previous = inFlightByPhone.get(phone) || Promise.resolve();
      const current = previous
        .then(() => onMessage(phone, joined, entry.sock))
        .catch((err) => console.error('Error procesando mensajes de', phone, err))
        .finally(() => {
          if (inFlightByPhone.get(phone) === current) inFlightByPhone.delete(phone);
        });
      inFlightByPhone.set(phone, current);
    }, DEBOUNCE_MS);
    pendingByPhone.set(phone, entry);
  }

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

  // --- WhatsApp: se conecta después de tomar el candado de instancia única.
  // Evita que dos procesos abran la misma sesión a la vez (ej. un redeploy
  // con solapamiento en un Web Service) — eso fue lo que causó el
  // conflicto "device_removed" (401) que tumbó la sesión antes. No bloquea
  // el arranque del servidor HTTP, así el healthcheck de Render sigue
  // respondiendo mientras espera el candado.
  const lockPath = nodePath.join(nodePath.dirname(BAILEYS_AUTH_PATH), 'whatsapp.lock');
  acquireSingletonLock(lockPath)
    .then(() => startWhatsApp(BAILEYS_AUTH_PATH, enqueueMessage, transcriber))
    .catch((err) => console.error('Error fatal conectando WhatsApp:', err));
}

main().catch((err) => {
  console.error('Error fatal al arrancar IA VIREX:', err);
  process.exit(1);
});
