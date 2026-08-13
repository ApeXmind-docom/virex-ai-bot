'use strict';

const state = require('./state');
const { getStats } = require('./store');

function maskPhone(jid) {
  const digits = String(jid).replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return '•••••' + digits.slice(-4);
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

function renderPanel(db, env) {
  const s = state.getState();
  const stats = getStats(db);
  const dailyCap = Number(env.MAX_DAILY_API_CALLS || 300);
  const pct = Math.min(100, Math.round((stats.apiCallsToday / dailyCap) * 100));

  const statusLabel =
    s.status === 'connected' ? 'Conectada' : s.status === 'connecting' ? 'Conectando…' : 'Desconectada';
  const statusColor = s.status === 'connected' ? '#1fae5f' : s.status === 'connecting' ? '#e0a51b' : '#e01b12';

  const qrBlock =
    s.status === 'connected'
      ? `<p style="color:#7a7a7a">No se necesita QR — la sesión ya está vinculada.</p>`
      : s.qrDataUrl
      ? `<img src="${s.qrDataUrl}" alt="Código QR para vincular WhatsApp" style="width:260px;height:260px;border:1px solid #2a2a2a;border-radius:4px">
         <p style="color:#7a7a7a;font-size:.8125rem;margin-top:.75rem">Escanéalo desde WhatsApp → Dispositivos vinculados → Vincular un dispositivo. Se renueva solo cada ~20 segundos si no lo escaneas a tiempo — refresca la página para ver el más reciente.</p>`
      : `<p style="color:#7a7a7a">Esperando un código QR… refresca en unos segundos.</p>`;

  const recentRows = stats.recentPhones
    .map(
      (r) =>
        `<tr><td style="padding:.5rem .75rem;border-top:1px solid #2a2a2a">${maskPhone(r.phone)}</td>
         <td style="padding:.5rem .75rem;border-top:1px solid #2a2a2a;color:#7a7a7a">${formatSince(r.last_at)}</td></tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>IA VIREX — Panel</title>
<style>
  body{background:#050505;color:#edeae4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;
    margin:0;padding:2rem 1.25rem;max-width:640px;margin-inline:auto}
  h1{font-size:1.5rem;margin-bottom:.25rem}
  .sub{color:#7a7a7a;font-size:.875rem;margin-top:0}
  .card{border:1px solid #2a2a2a;background:#0e0e0e;border-radius:6px;padding:1.5rem;margin-top:1.5rem}
  .status-dot{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;margin-right:.5rem}
  .stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem}
  .stat{border:1px solid #2a2a2a;border-radius:4px;padding:1rem}
  .stat .n{font-size:1.75rem;font-weight:700}
  .stat .l{color:#7a7a7a;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
  .bar-bg{background:#1a1a1a;border-radius:99px;height:8px;overflow:hidden;margin-top:.5rem}
  .bar-fill{background:#e01b12;height:100%}
  table{width:100%;border-collapse:collapse;margin-top:.5rem;font-size:.875rem}
  th{text-align:left;padding:.5rem .75rem;color:#7a7a7a;font-size:.75rem;text-transform:uppercase}
</style>
</head>
<body>
  <h1>IA VIREX</h1>
  <p class="sub">Panel de estado — se actualiza solo cada 15 segundos</p>

  <div class="card">
    <span class="status-dot" style="background:${statusColor}"></span><strong>${statusLabel}</strong>
    ${s.connectedSince ? `<p class="sub">Conectada ${formatSince(s.connectedSince)}</p>` : ''}
    <div style="margin-top:1.25rem;text-align:center">${qrBlock}</div>
  </div>

  <div class="card">
    <strong>Uso de hoy</strong>
    <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
    <p class="sub">${stats.apiCallsToday} / ${dailyCap} respuestas de IA usadas hoy (${pct}%)</p>

    <div class="stat-grid">
      <div class="stat"><div class="n">${stats.conversationsToday}</div><div class="l">Conversaciones hoy</div></div>
      <div class="stat"><div class="n">${stats.conversationsTotal}</div><div class="l">Conversaciones totales</div></div>
      <div class="stat"><div class="n">${stats.messagesTotal}</div><div class="l">Mensajes recibidos</div></div>
      <div class="stat"><div class="n">${dailyCap - stats.apiCallsToday}</div><div class="l">Respuestas restantes hoy</div></div>
    </div>
  </div>

  <div class="card">
    <strong>Conversaciones recientes</strong>
    <table>
      <thead><tr><th>Número</th><th>Última actividad</th></tr></thead>
      <tbody>${recentRows || '<tr><td style="padding:.75rem;color:#7a7a7a" colspan="2">Todavía no hay conversaciones.</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`;
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
