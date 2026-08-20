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
