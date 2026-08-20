'use strict';

const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const state = require('./state');

let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000; // tope de 5 minutos entre intentos

/**
 * @param {string} authPath  Carpeta persistente donde vive la sesión (disco de Render).
 * @param {(phone:string, text:string) => Promise<void>} onMessage  Handler de mensajes entrantes.
 */
async function startWhatsApp(authPath, onMessage) {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
  } = await import('@whiskeysockets/baileys');

  const { state: authState, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'warn' });

  const sock = makeWASocket({
    version,
    auth: authState,
    logger,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n=== Escanea este QR con el WhatsApp del número de IA VIREX ===\n');
      qrcode.generate(qr, { small: true });
      QRCode.toDataURL(qr, { margin: 1, width: 320 })
        .then((dataUrl) => state.setQr(dataUrl))
        .catch((err) => console.error('Error generando QR para el panel:', err));
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      // Casos donde NO hay que reintentar nunca — requieren intervención
      // humana (volver a escanear QR, o revisar el estado con Meta).
      // Reintentar automáticamente en estos casos es lo que causó el
      // problema anterior: machacar el servidor con una sesión ya inválida.
      const noReintentar = [
        DisconnectReason.loggedOut, // sesión cerrada manualmente
        DisconnectReason.forbidden, // 403 — número bloqueado o rechazado por WhatsApp
        DisconnectReason.badSession, // sesión corrupta, necesita QR nuevo
      ];

      if (noReintentar.includes(statusCode)) {
        state.setBlocked(statusCode);
        console.error(
          `⛔ Conexión cerrada de forma DEFINITIVA (código ${statusCode}). NO se reintentará automáticamente.`,
          statusCode === DisconnectReason.forbidden
            ? 'El número puede estar bloqueado por WhatsApp/Meta — revisa el estado de la cuenta antes de volver a intentar.'
            : 'Borra la carpeta de auth y vuelve a escanear el QR desde el panel.'
        );
        return;
      }

      // Para el resto de casos (caída de red, reinicio de Render, etc.),
      // sí reconectamos, pero con espera progresiva — nunca en loop cerrado.
      reconnectAttempts += 1;
      const
