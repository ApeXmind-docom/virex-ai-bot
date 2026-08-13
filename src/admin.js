'use strict';

const state = require('./state');
const { getStats, listConversations, getFullThread } = require('./store');

function maskPhone(jid) {
  const digits = String(jid).replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return '•••••' + digits.slice(-4);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSince(ts) {
  if (!ts) return '—';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const SHARED_STYLES = `
  *{box-sizing:border-box}
  body{background:#050505;color:#edeae4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;
    margin:0;padding:0}
  .wrap{max-width:960px;margin-inline:auto;padding:1.5rem 1.25rem 3rem}
  a{color:inherit;text-decoration:none}
  .topbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;
    gap:1rem;padding-bottom:1.25rem;border-bottom:1px solid #1f1f1f;margin-bottom:1.5rem}
  .brand-eyebrow{font-family:monospace;font-size:.6875rem;letter-spacing:.14em;
    text-transform:uppercase;color:#7a7a7a;margin:0}
  .brand-title{font-size:1.5rem;font-weight:800;margin:.15rem 0}
  .brand-sub{font-family:monospace;font-size:.6875rem;letter-spacing:.1em;
    text-transform:uppercase;color:#7a7a7a;margin:0}
  .pill{display:inline-flex;align-items:center;gap:.5rem;border:1px solid #2a2a2a;
    border-radius:999px;padding:.5rem 1rem;font-size:.8125rem}
  .dot{width:.55rem;height:.55rem;border-radius:50%;flex:none}
  .tabs{display:flex;gap:1.75rem;border-bottom:1px solid #1f1f1f;margin-bottom:1.5rem;
    font-family:monospace;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase}
  .tab{padding-bottom:.85rem;color:#7a7a7a;border-bottom:2px solid transparent;margin-bottom:-1px}
  .tab.active{color:#e01b12;border-bottom-color:#e01b12}
  .card{border:1px solid #1f1f1f;background:#0e0e0e;border-radius:8px;padding:1.5rem;margin-top:1.25rem}
  .stat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem}
  @media(min-width:640px){.stat-grid{grid-template-columns:repeat(3,1fr)}}
  .stat{border:1px solid #1f1f1f;border-radius:6px;padding:1.1rem}
  .stat .n{font-size:1.75rem;font-weight:800;color:#e01b12}
  .stat .l{color:#7a7a7a;font-family:monospace;font-size:.6875rem;text-transform:uppercase;
    letter-spacing:.06em;margin-top:.25rem}
  .bar-bg{background:#1a1a1a;border-radius:99px;height:8px;overflow:hidden;margin-top:.5rem}
  .bar-fill{background:#e01b12;height:100%}
  table{width:100%;border-collapse:collapse;font-size:.875rem}
  th{text-align:left;padding:.6rem .75rem;color:#7a7a7a;font-family:monospace;
    font-size:.6875rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #1f1f1f}
  td{padding:.7rem .75rem;border-top:1px solid #1a1a1a}
  tr.rowlink:hover{background:#141414;cursor:pointer}
  .msg{border-radius:8px;padding:.75rem 1rem;margin-top:.6rem;max-width:80%;font-size:.875rem;line-height:1.5}
  .msg.user{background:#161616;border:1px solid #2a2a2a}
  .msg.assistant{background:#1a0a09;border:1px solid #3a1512;margin-left:auto}
  .msg .meta{font-family:monospace;font-size:.6875rem;color:#7a7a7a;margin-bottom:.3rem}
  .empty{color:#7a7a7a;padding:1.5rem;text-align:center;font-size:.875rem}
  .backlink{font-family:monospace;font-size:.75rem;color:#7a7a7a;display:inline-block;margin-bottom:1rem}
`;

function layout({ title, activeTab, key, statusPill, body }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="20">
<title>${title}</title>
<style>${SHARED_STYLES}</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div>
      <p class="brand-eyebrow">PRAXO</p>
      <p class="brand-title">IA VIREX</p>
      <p class="brand-sub">Panel de control</p>
    </div>
    ${statusPill}
  </div>

  <div class="tabs">
    <a class="tab ${activeTab === 'dashboard' ? 'active' : ''}" href="/?key=${key}">Dashboard</a>
    <a class="tab ${activeTab === 'conversaciones' ? 'active' : ''}" href="/?key=${key}&tab=conversaciones">Conversaciones</a>
  </div>

  ${body}
</div>
</body>
</html>`;
}

function statusPillHtml(s, key) {
  const label = s.status === 'connected' ? 'Conectada' : s.status === 'connecting' ? 'Conectando…' : 'Desconectada';
  const color = s.status === 'connected' ? '#1fae5f' : s.status === 'connecting' ? '#e0a51b' : '#e01b12';
  return `<span class="pill"><span class="dot" style="background:${color}"></span>${label}${
    s.status === 'connected' && s.connectedSince ? ` · ${formatSince(s.connectedSince)}` : ''
  }</span>`;
}

function renderDashboard(db, env, key) {
  const s = state.getState();
  const stats = getStats(db);
  const dailyCap = Number(env.MAX_DAILY_API_CALLS || 300);
  const pct = Math.min(100, Math.round((stats.apiCallsToday / dailyCap) * 100));

  const qrBlock =
    s.status === 'connected'
      ? `<p style="color:#7a7a7a">No se necesita QR — la sesión ya está vinculada.</p>`
      : s.qrDataUrl
      ? `<img src="${s.qrDataUrl}" alt="Código QR para vincular WhatsApp" style="width:240px;height:240px;border:1px solid #2a2a2a;border-radius:4px">
         <p style="color:#7a7a7a;font-size:.8125rem;margin-top:.75rem">Escanéalo desde WhatsApp → Dispositivos vinculados. Se renueva solo — refresca la página si expiró.</p>`
      : `<p style="color:#7a7a7a">Esperando un código QR… refresca en unos segundos.</p>`;

  const recentRows = stats.recentPhones
    .map(
      (r) => `<tr class="rowlink" onclick="location.href='/?key=${key}&tab=conversaciones&phone=${encodeURIComponent(r.phone)}'">
        <td>${maskPhone(r.phone)}</td><td style="color:#7a7a7a">${formatSince(r.last_at)}</td></tr>`
    )
    .join('');

  const body = `
    <div class="card">
      <div style="text-align:center">${qrBlock}</div>
    </div>

    <div class="card">
      <strong>Uso de hoy</strong>
      <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
      <p style="color:#7a7a7a;font-size:.8125rem;margin-top:.5rem">${stats.apiCallsToday} / ${dailyCap} respuestas de IA usadas hoy (${pct}%)</p>
      <div class="stat-grid" style="margin-top:1rem">
        <div class="stat"><div class="n">${stats.conversationsToday}</div><div class="l">Conversaciones hoy</div></div>
        <div class="stat"><div class="n">${stats.conversationsTotal}</div><div class="l">Conversaciones totales</div></div>
        <div class="stat"><div class="n">${stats.messagesToday}</div><div class="l">Mensajes hoy</div></div>
        <div class="stat"><div class="n">${stats.messagesTotal}</div><div class="l">Mensajes totales</div></div>
        <div class="stat"><div class="n">${dailyCap - stats.apiCallsToday}</div><div class="l">Restantes hoy</div></div>
      </div>
    </div>

    <div class="card">
      <strong>Conversaciones recientes</strong>
      <table style="margin-top:.75rem">
        <thead><tr><th>Número</th><th>Última actividad</th></tr></thead>
        <tbody>${recentRows || '<tr><td class="empty" colspan="2">Todavía no hay conversaciones.</td></tr>'}</tbody>
      </table>
    </div>`;

  return layout({ title: 'IA VIREX — Panel', activeTab: 'dashboard', key, statusPill: statusPillHtml(s, key), body });
}

function renderConversationList(db, key) {
  const s = state.getState();
  const conversations = listConversations(db);

  const rows = conversations
    .map(
      (c) => `<tr class="rowlink" onclick="location.href='/?key=${key}&tab=conversaciones&phone=${encodeURIComponent(c.phone)}'">
        <td>${maskPhone(c.phone)}</td>
        <td>${c.user_messages}</td>
        <td style="color:#7a7a7a">${formatSince(c.last_at)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="card">
      <strong>Todas las conversaciones</strong>
      <table style="margin-top:.75rem">
        <thead><tr><th>Número</th><th>Mensajes</th><th>Última actividad</th></tr></thead>
        <tbody>${rows || '<tr><td class="empty" colspan="3">Todavía no hay conversaciones.</td></tr>'}</tbody>
      </table>
    </div>`;

  return layout({
    title: 'IA VIREX — Conversaciones',
    activeTab: 'conversaciones',
    key,
    statusPill: statusPillHtml(s, key),
    body,
  });
}

function renderConversationDetail(db, key, phone) {
  const s = state.getState();
  const thread = getFullThread(db, phone);

  const bubbles = thread
    .map(
      (m) => `<div class="msg ${m.role}">
        <div class="meta">${m.role === 'user' ? maskPhone(phone) : 'IA VIREX'} · ${formatDateTime(m.created_at)}</div>
        ${escapeHtml(m.content).replace(/\n/g, '<br>')}
      </div>`
    )
    .join('');

  const body = `
    <a class="backlink" href="/?key=${key}&tab=conversaciones">&larr; Volver a conversaciones</a>
    <div class="card">
      <strong>Conversación con ${maskPhone(phone)}</strong>
      <div style="margin-top:1rem">${bubbles || '<p class="empty">Sin mensajes.</p>'}</div>
    </div>`;

  return layout({
    title: 'IA VIREX — Conversación',
    activeTab: 'conversaciones',
    key,
    statusPill: statusPillHtml(s, key),
    body,
  });
}

/** Decide qué vista renderizar según los parámetros de la URL. */
function renderPanel(db, env, req, key) {
  const url = new URL(req.url, 'http://localhost');
  const tab = url.searchParams.get('tab');
  const phone = url.searchParams.get('phone');

  if (tab === 'conversaciones' && phone) return renderConversationDetail(db, key, phone);
  if (tab === 'conversaciones') return renderConversationList(db, key);
  return renderDashboard(db, env, key);
}

/** true si la request trae la clave correcta (?key=... en la URL). */
function isAuthorized(req, adminPassword) {
  if (!adminPassword) return false; // sin contraseña configurada, el panel no se sirve nunca
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get('key') === adminPassword;
  } catch {
    return false;
  }
}

module.exports = { renderPanel, isAuthorized };
