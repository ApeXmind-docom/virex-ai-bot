'use strict';

const { waitLikeHuman } = require('./humanize');
const {
  addFollowups,
  getDueFollowups,
  isFollowupPending,
  markFollowup,
  isOptedOut,
  isCustomer,
  saveMessage,
} = require('./store');
const { APELATIVO } = require('./flow');

/**
 * Seguimientos automáticos: si el cliente vio la oferta (imagen de precios) y
 * deja de contestar, Paola le escribe tres veces como máximo:
 *   1. a la media hora: se ofrece a resolver dudas sobre el producto
 *   2. a la hora: un saludo corto, disponible para ayudar (sin "buenos días": puede salir a cualquier hora)
 *   3. al día siguiente a las 10:00 a. m.: lo tranquiliza en una línea (paga al recibir, paquete discreto) y menciona el regalo
 * Los tres son cortos y de ayuda, sin presionar la venta ni avisar que "es el último".
 * {apodo} se reemplaza por "señor"; solo va en el 1 y el 3 (el 2 sin apodo, para no saturar).
 *
 * Reglas para no ser una molestia (ni un riesgo para el número):
 *  - Cualquier mensaje del cliente cancela los pendientes (ver index.js).
 *  - Si pide que no le escriban, no se le manda nada (isOptOut en flow.js).
 *  - Solo se escribe entre las 8:00 a. m. y las 8:00 p. m. de Colombia; los
 *    seguimientos 1 y 2 que caerían de noche se descartan (no se acumulan
 *    para la mañana). El 3 siempre sale a las 10:00 del día siguiente.
 *  - Un seguimiento que quedó muy atrasado (el bot estuvo caído) se descarta
 *    en vez de mandarse tarde.
 */

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const COLOMBIA_OFFSET_MS = -5 * HOUR_MS; // Colombia no tiene horario de verano
const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR = 20;
const NEXT_DAY_HOUR = 10;

const STEPS = [
  {
    step: 1,
    maxLateMs: 2 * HOUR_MS,
    text: `Hola, {apodo} 😊 soy Paola. Cuéntame, ¿hay algo que quieras saber más del producto? Con gusto te ayudo 💛`,
  },
  {
    step: 2,
    maxLateMs: 2 * HOUR_MS,
    text: `¡Hola! 😊 Quedo atenta por si quieres preguntarme algo del producto 💛`,
  },
  {
    step: 3,
    maxLateMs: 6 * HOUR_MS,
    text: `Por si te sirve: pagas cuando lo recibes en tu casa y llega en paquete discreto 📦
Y si te animas, {apodo}, te voy a enviar un regalo 🎁
¿Te quedó alguna duda? Aquí estoy para ayudarte 🤗`,
  },
];

function colombiaParts(ts) {
  const d = new Date(ts + COLOMBIA_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() };
}

function colombiaTime(y, m, d, h) {
  return Date.UTC(y, m, d, h) - COLOMBIA_OFFSET_MS;
}

function inSendWindow(ts) {
  const { h } = colombiaParts(ts);
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

/** Cuándo salen los 3 seguimientos de una oferta enviada en `offerAt`. */
function planFollowups(offerAt) {
  const plan = [];
  const first = offerAt + 30 * MIN_MS;
  const second = offerAt + 60 * MIN_MS;
  if (inSendWindow(first)) plan.push({ step: 1, dueAt: first });
  if (inSendWindow(second)) plan.push({ step: 2, dueAt: second });
  const p = colombiaParts(offerAt);
  plan.push({ step: 3, dueAt: colombiaTime(p.y, p.m, p.d + 1, NEXT_DAY_HOUR) });
  return plan;
}

/** Programa los seguimientos de este cliente (reemplaza los pendientes). */
function scheduleFollowups(db, phone, { enabled = true, now = Date.now() } = {}) {
  if (!enabled || isOptedOut(db, phone) || isCustomer(db, phone)) return;
  addFollowups(db, phone, planFollowups(now));
}

/**
 * Manda los seguimientos que ya vencieron. Se llama cada minuto desde
 * index.js; si algo falla el seguimiento queda pendiente y se reintenta.
 */
async function runDueFollowups({ db, sock, now = Date.now() }) {
  for (const due of getDueFollowups(db, now)) {
    const def = STEPS.find((s) => s.step === due.step);
    if (!def || isOptedOut(db, due.phone) || isCustomer(db, due.phone)) {
      markFollowup(db, due.id, 'cancelled');
      continue;
    }
    if (now - due.due_at > def.maxLateMs || !inSendWindow(now)) {
      markFollowup(db, due.id, 'skipped');
      continue;
    }
    // El cliente pudo escribir mientras se armaba esta tanda.
    if (!isFollowupPending(db, due.id)) continue;

    try {
      const text = def.text.replace(/\{apodo\}/g, APELATIVO);
      await waitLikeHuman(sock, due.phone, text);
      await sock.sendMessage(due.phone, { text });
      saveMessage(db, due.phone, 'assistant', text);
      markFollowup(db, due.id, 'sent');
      console.log(`Seguimiento ${def.step} enviado a ${due.phone}`);
    } catch (err) {
      console.error(`No se pudo enviar el seguimiento ${def.step} a ${due.phone}:`, err.message);
    }
  }
}

module.exports = { STEPS, planFollowups, scheduleFollowups, runDueFollowups };
