'use strict';

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

function initStore(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone, created_at);

    CREATE TABLE IF NOT EXISTS daily_usage (
      day TEXT PRIMARY KEY,
      api_calls INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_rate (
      phone TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    );
  `);

  return db;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Historial reciente de un usuario, en orden cronológico, listo para pasarle a Claude. */
function getHistory(db, phone, windowSize) {
  const rows = db
    .prepare(
      `SELECT role, content FROM messages
       WHERE phone = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(phone, windowSize);
  return rows.reverse();
}

function saveMessage(db, phone, role, content) {
  db.prepare(
    `INSERT INTO messages (phone, role, content, created_at) VALUES (?,?,?,?)`
  ).run(phone, role, content, Date.now());
}

/** true si YA se alcanzó el tope diario global de llamadas a la API. */
function isDailyCapReached(db, maxDailyCalls) {
  const day = todayKey();
  const row = db.prepare(`SELECT api_calls FROM daily_usage WHERE day = ?`).get(day);
  const calls = row ? row.api_calls : 0;
  return calls >= maxDailyCalls;
}

function incrementDailyUsage(db) {
  const day = todayKey();
  db.prepare(
    `INSERT INTO daily_usage (day, api_calls) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET api_calls = api_calls + 1`
  ).run(day);
}

/** true si ESTE usuario ya superó su límite de mensajes en la ventana de 1 hora. */
function isUserRateLimited(db, phone, maxPerHour) {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const row = db.prepare(`SELECT window_start, count FROM user_rate WHERE phone = ?`).get(phone);

  if (!row || now - row.window_start > hourMs) {
    db.prepare(
      `INSERT INTO user_rate (phone, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(phone) DO UPDATE SET window_start = ?, count = 1`
    ).run(phone, now, now);
    return false;
  }

  if (row.count >= maxPerHour) return true;

  db.prepare(`UPDATE user_rate SET count = count + 1 WHERE phone = ?`).run(phone);
  return false;
}

/** Estadísticas para el panel de administración. */
function getStats(db) {
  const day = todayKey();
  const dayStartMs = new Date(day + 'T00:00:00').getTime();

  const todayCalls = db.prepare(`SELECT api_calls FROM daily_usage WHERE day = ?`).get(day);
  const totalConversations = db.prepare(`SELECT COUNT(DISTINCT phone) AS n FROM messages`).get();
  const todayConversations = db
    .prepare(`SELECT COUNT(DISTINCT phone) AS n FROM messages WHERE created_at >= ?`)
    .get(dayStartMs);
  const totalMessages = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE role = 'user'`).get();
  const todayMessages = db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE role = 'user' AND created_at >= ?`)
    .get(dayStartMs);
  const recentPhones = db
    .prepare(
      `SELECT phone, MAX(created_at) AS last_at FROM messages
       GROUP BY phone ORDER BY last_at DESC LIMIT 10`
    )
    .all();

  return {
    apiCallsToday: todayCalls ? todayCalls.api_calls : 0,
    conversationsTotal: totalConversations.n,
    conversationsToday: todayConversations.n,
    messagesTotal: totalMessages.n,
    messagesToday: todayMessages.n,
    recentPhones,
  };
}

/** Lista completa de conversaciones (una fila por número), para la pestaña Conversaciones. */
function listConversations(db) {
  return db
    .prepare(
      `SELECT phone,
              MAX(created_at) AS last_at,
              MIN(created_at) AS first_at,
              COUNT(*) FILTER (WHERE role = 'user') AS user_messages,
              COUNT(*) AS total_messages
       FROM messages
       GROUP BY phone
       ORDER BY last_at DESC`
    )
    .all();
}

/** Hilo completo de una conversación puntual, en orden cronológico. */
function getFullThread(db, phone) {
  return db
    .prepare(`SELECT role, content, created_at FROM messages WHERE phone = ? ORDER BY created_at ASC`)
    .all(phone);
}

module.exports = {
  initStore,
  getHistory,
  saveMessage,
  isDailyCapReached,
  incrementDailyUsage,
  isUserRateLimited,
  getStats,
  listConversations,
  getFullThread,
};
