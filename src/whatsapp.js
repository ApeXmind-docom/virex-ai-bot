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
 * @param {{transcribe:Function}|null} transcriber  Transcriptor de notas de voz (Whisper), o null si no está configurado.
 */
async function startWhatsApp(authPath, onMessage, transcriber) {
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
      const delayMs = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
      state.setConnecting();
      console.log(
        `Conexión cerrada (código ${statusCode}). Reintentando en ${Math.round(delayMs / 1000)}s (intento ${reconnectAttempts})...`
      );
      setTimeout(() => startWhatsApp(authPath, onMessage, transcriber), delayMs);
    } else if (connection === 'open') {
      reconnectAttempts = 0; // se reconectó bien, resetea el contador de espera
      state.setConnected();
      console.log('✓ IA VIREX conectada a WhatsApp');
    }
  });



  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const phone = msg.key.remoteJid;
      if (!phone || phone.endsWith('@g.us')) continue; // ignorar grupos

      let text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

      // --- Notas de voz: se transcriben y se tratan igual que un texto ---
      const audio = msg.message.audioMessage;
      if (!text.trim() && audio) {
        if (!transcriber) {
          console.warn('Llegó una nota de voz pero no hay transcriptor configurado.');
          await sock.sendMessage(phone, {
            text: 'Por ahora no puedo escuchar notas de voz 😅 ¿me lo escribes?',
          });
          continue;
        }

        try {
          const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          const transcrito = await transcriber.transcribe(buffer, audio.seconds);

          if (transcrito) {
            console.log(`Nota de voz transcrita de ${phone}: "${transcrito.slice(0, 60)}..."`);
            text = transcrito;
          } else {
            await sock.sendMessage(phone, {
              text: 'No alcancé a entender bien el audio 😅 ¿me lo repites o me lo escribes?',
            });
            continue;
          }
        } catch (err) {
          console.error('Error descargando/transcribiendo nota de voz:', err.message);
          await sock.sendMessage(phone, {
            text: 'Tuve un problema escuchando tu audio 😅 ¿me lo escribes mejor?',
          });
          continue;
        }
      }

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
