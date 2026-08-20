'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const OpenAI = require('openai');

/**
 * Transcripción de notas de voz de WhatsApp con Whisper (OpenAI).
 *
 * Los clientes de este público (hombres 45-65) mandan muchas notas de voz
 * en vez de escribir — sin esto, el bot simplemente las ignoraría y se
 * perdería la venta.
 *
 * Control de costo: Whisper cobra por minuto de audio, así que hay un
 * tope de duración por nota. Un audio de 3 minutos cuesta poco, pero si
 * alguien manda 20 audios largos seguidos sí se acumula.
 */

function createTranscriber(env) {
  if (!env.OPENAI_API_KEY) {
    console.warn(
      'AVISO: no hay OPENAI_API_KEY configurada — las notas de voz no se van a transcribir.'
    );
    return null;
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const maxSeconds = Number(env.MAX_AUDIO_SECONDS || 180); // 3 minutos por defecto

  /**
   * @param {Buffer} audioBuffer  Bytes del audio ya descargado de WhatsApp.
   * @param {number} durationSec  Duración reportada por WhatsApp, para el tope.
   * @returns {Promise<string|null>}  Texto transcrito, o null si no se pudo.
   */
  async function transcribe(audioBuffer, durationSec) {
    if (durationSec && durationSec > maxSeconds) {
      console.warn(`Audio de ${durationSec}s supera el tope de ${maxSeconds}s — no se transcribe.`);
      return null;
    }

    // La API de OpenAI necesita un archivo real, no solo el buffer en memoria.
    const tmpPath = path.join(os.tmpdir(), `virex-audio-${Date.now()}.ogg`);

    try {
      fs.writeFileSync(tmpPath, audioBuffer);

      const result = await client.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-1',
        language: 'es', // el público es colombiano — fijarlo mejora precisión y velocidad
      });

      const text = (result.text || '').trim();
      return text || null;
    } catch (err) {
      console.error('Error transcribiendo audio con Whisper:', err.message);
      return null;
    } finally {
      // Siempre limpiar el archivo temporal, haya funcionado o no.
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch (cleanupErr) {
        console.error('No se pudo borrar el archivo temporal de audio:', cleanupErr.message);
      }
    }
  }

  return { transcribe };
}

module.exports = { createTranscriber };
