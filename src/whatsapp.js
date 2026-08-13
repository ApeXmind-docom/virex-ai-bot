'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

/**
 * @param {string} authPath  Carpeta persistente donde vive la sesión (disco de Render).
 * @param {(phone:string, text:string) => Promise<void>} onMessage  Handler de mensajes entrantes.
 */
async function startWhatsApp(authPath, onMessage) {
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'warn' });

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n=== Escanea este QR con el WhatsApp del número de IA VIREX ===\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada.', { statusCode, shouldReconnect });
      if (shouldReconnect) {
        startWhatsApp(authPath, onMessage);
      } else {
        console.log('Sesión cerrada (logout). Borra la carpeta de auth y vuelve a escanear el QR.');
      }
    } else if (connection === 'open') {
      console.log('✓ IA VIREX conectada a WhatsApp');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const phone = msg.key.remoteJid;
      if (!phone || phone.endsWith('@g.us')) continue; // ignorar grupos

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

      if (!text.trim()) continue;

      try {
        await onMessage(phone, text.trim(), sock);
      } catch (err) {
        console.error('Error procesando mensaje de', phone, err);
      }
    }
  });

  return sock;
}

module.exports = { startWhatsApp };
