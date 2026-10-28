'use strict';

const { waitLikeHuman } = require('./humanize');
const {
  addFollowups,
  getDueFollowups,
  isFollowupPending,
  markFollowup,
  isOptedOut,
  saveMessage,
} = require('./store');

/**
 * Seguimientos automáticos: si el cliente vio la oferta (imagen de precios) y
 * deja de contestar, Paola le escribe tres veces como máximo:
 *   1. a la media hora: pregunta la ciudad (entrega inmediata vs. contra entrega)
 *   2. a la hora: le quita el miedo a comprar (paga al recibir, discreto, original)
 *   3. al día siguiente a las 10:00 a. m.: último empujón
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
    text: `¿Pudiste ver la oferta? 😊
Cuéntame, ¿en qué ciudad estás? En las principales ciudades tenemos entrega inmediata 🚀 y al resto del país te lo enviamos contra entrega 🚚`,
  },
  {
    step: 2,
    maxLateMs: 2 * HOUR_MS,
    text: `Te cuento algo para que estés tranquilo 🙌
✅ No pagas nada por adelantado: pagas cuando lo recibes.
📦 Llega en paquete discreto, nadie sabe qué contiene.
🔒 Producto 100% original y sellado.
¿Tienes alguna duda? O si prefieres, empieza con 1 frasco para que lo pruebes 😉`,
  },
  {
    step: 3,
    maxLateMs: 6 * HOUR_MS,
    text: `¡Hola! 👋 Te escribo por última vez para no molestarte 😊
La promoción con obsequio y envío gratis sigue disponible para ti.
¿Te lo enviamos hoy? Solo dime tu nombre y tu ciudad 🚚`,
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
  if (!enabled || isOptedOut(db, phone)) return;
  addFollowups(db, phone, planFollowups(now));
}

/**
 * Manda los seguimientos que ya vencieron. Se llama cada minuto desde
 * index.js; si algo falla el seguimiento queda pendiente y se reintenta.
 */
async function runDueFollowups({ db, sock, now = Date.now() }) {
  for (const due of getDueFollowups(db, now)) {
    const def = STEPS.find((s) => s.step === due.step);
    if (!def || isOptedOut(db, due.phone)) {
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
      await waitLikeHuman(sock, due.phone, def.text);
      await sock.sendMessage(due.phone, { text: def.text });
      saveMessage(db, due.phone, 'assistant', def.text);
      markFollowup(db, due.id, 'sent');
      console.log(`Seguimiento ${def.step} enviado a ${due.phone}`);
    } catch (err) {
      console.error(`No se pudo enviar el seguimiento ${def.step} a ${due.phone}:`, err.message);
    }
  }
}

module.exports = { STEPS, planFollowups, scheduleFollowups, runDueFollowups };
