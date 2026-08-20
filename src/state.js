'use strict';

/**
 * Estado compartido en memoria entre whatsapp.js (que lo actualiza) y
 * admin.js (que lo lee para pintar el panel). No se persiste a disco a
 * propósito — es solo el estado "de ahora mismo" del proceso.
 */
const state = {
  status: 'connecting', // 'connecting' | 'connected' | 'disconnected' | 'blocked'
  qrDataUrl: null, // imagen del QR en base64, o null si no hay uno pendiente
  connectedSince: null, // timestamp de cuándo se conectó por última vez
  lastQrAt: null,
  blockedCode: null, // código de error cuando status === 'blocked'
};

function setConnecting() {
  state.status = 'connecting';
  state.blockedCode = null;
}

function setQr(dataUrl) {
  state.qrDataUrl = dataUrl;
  state.lastQrAt = Date.now();
  state.status = 'connecting';
}

function setConnected() {
  state.status = 'connected';
  state.qrDataUrl = null;
  state.connectedSince = Date.now();
  state.blockedCode = null;
}

function setDisconnected() {
  state.status = 'disconnected';
}

/** Se cerró de forma definitiva (bloqueo, logout, sesión corrupta) — no se reintenta solo. */
function setBlocked(code) {
  state.status = 'blocked';
  state.blockedCode = code;
  state.qrDataUrl = null;
}

function getState() {
  return { ...state };
}

module.exports = { setConnecting, setQr, setConnected, setDisconnected, setBlocked, getState };
