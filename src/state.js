'use strict';

/**
 * Estado compartido en memoria entre whatsapp.js (que lo actualiza) y
 * admin.js (que lo lee para pintar el panel). No se persiste a disco a
 * propósito — es solo el estado "de ahora mismo" del proceso.
 */
const state = {
  status: 'connecting', // 'connecting' | 'connected' | 'disconnected'
  qrDataUrl: null, // imagen del QR en base64, o null si no hay uno pendiente
  connectedSince: null, // timestamp de cuándo se conectó por última vez
  lastQrAt: null,
};

function setConnecting() {
  state.status = 'connecting';
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
}

function setDisconnected() {
  state.status = 'disconnected';
}

function getState() {
  return { ...state };
}

module.exports = { setConnecting, setQr, setConnected, setDisconnected, getState };
