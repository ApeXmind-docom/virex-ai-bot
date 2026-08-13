'use strict';

const crypto = require('node:crypto');

/**
 * Sesiones del panel en memoria (Map token -> expiración). Se reinician
 * si el proceso se reinicia (redeploy, caída) — eso solo significa que
 * hay que volver a iniciar sesión, no es un problema de seguridad.
 */
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const entry = sessions.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  sessions.delete(token);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

/** Lee el body de una request POST con Content-Type application/x-www-form-urlencoded. */
function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy(); // límite de seguridad, un form de login es pequeño
    });
    req.on('end', () => {
      const params = new URLSearchParams(data);
      resolve(Object.fromEntries(params));
    });
    req.on('error', reject);
  });
}

module.exports = { createSession, isValidSession, destroySession, parseCookies, parseFormBody };
