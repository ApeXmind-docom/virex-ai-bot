'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HEARTBEAT_MS = 15_000;
const STALE_MS = 60_000; // si el heartbeat no se actualiza en 60s, se asume que el dueño murió

/**
 * Evita que dos procesos abran la sesión de WhatsApp al mismo tiempo — eso
 * es lo que produce el conflicto "device_removed" (401) que tumbó la
 * sesión antes. Pasa esto típicamente durante un redeploy con solapamiento
 * (instancia nueva arriba antes de que Render mate la vieja). Nunca falla
 * el arranque: si el lock está tomado, espera a que se libere.
 */
async function acquireSingletonLock(lockPath, { checkIntervalMs = 3000 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  let warned = false;
  for (;;) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), {
        flag: 'wx',
      });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > STALE_MS) {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
        break;
      }

      if (!warned) {
        console.warn(
          `Otra instancia parece tener la sesión de WhatsApp abierta (lock en ${lockPath}). ` +
            'Esperando a que se libere antes de conectar — esto es normal durante un redeploy.'
        );
        warned = true;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }

  const heartbeat = setInterval(() => {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    } catch (err) {
      console.error('Error actualizando el lock de sesión de WhatsApp:', err.message);
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  function release() {
    clearInterval(heartbeat);
    try {
      fs.unlinkSync(lockPath);
    } catch (_) {
      // no importa si ya no existe
    }
  }

  process.once('SIGTERM', release);
  process.once('SIGINT', release);

  return release;
}

module.exports = { acquireSingletonLock };
