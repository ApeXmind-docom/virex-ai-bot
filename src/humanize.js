'use strict';

/**
 * Pausa antes de responder, para no contestar de forma instantánea a cada
 * mensaje. Una IA que responde en milisegundos a un número que recién
 * empezó a recibir tráfico pago es exactamente el patrón que los sistemas
 * antiabuso de WhatsApp usan para detectar bots — sumado a eso deja de
 * sentirse como una persona real.
 */
function humanDelayMs(text) {
  const leyendo = 1200 + Math.random() * 1800; // 1.2-3s: "leer y pensar" el mensaje entrante
  const escribiendo = Math.min((text || '').length * 35, 4500); // ~35ms/carácter, tope 4.5s
  return Math.round(leyendo + escribiendo * (0.6 + Math.random() * 0.4));
}

/** Muestra "escribiendo…" y espera antes de enviar — nunca debe tumbar el mensaje si falla. */
async function waitLikeHuman(sock, phone, text) {
  try {
    await sock.sendPresenceUpdate('composing', phone);
  } catch (err) {
    console.warn('No se pudo mostrar "escribiendo…":', err.message);
  }

  await new Promise((resolve) => setTimeout(resolve, humanDelayMs(text)));
}

module.exports = { humanDelayMs, waitLikeHuman };
