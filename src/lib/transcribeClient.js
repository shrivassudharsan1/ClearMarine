/**
 * Forwards recorded audio to the Express backend, which calls ElevenLabs STT.
 * If REACT_APP_BACKEND_URL is unset, same-origin /api is used (Vercel single-app mode).
 */
function getBackendBase() {
  const raw = (process.env.REACT_APP_BACKEND_URL || '').trim().replace(/\/$/, '');
  if (raw) return raw;
  return '/api';
}

function stringifyTranscribeError(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    if (typeof err.message === 'string') return err.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Browser built-in TTS — works after a user tap; good fallback when ElevenLabs autoplay is blocked. */
export function speakWithWebSpeech(text) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      reject(new Error('Web Speech API not available in this browser'));
      return;
    }
    const line = String(text || '').trim().slice(0, 500);
    if (!line) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.rate = 1;
    u.onend = () => resolve();
    u.onerror = () => reject(new Error('Web Speech playback failed'));
    window.speechSynthesis.speak(u);
  });
}

/**
 * Speak text: try ElevenLabs (backend /tts), then Web Speech on failure or autoplay block.
 * @param {string} text
 * @param {{ preferElevenLabs?: boolean, webSpeechFallback?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, needsTap?: boolean, objectUrl?: string, usedWebSpeech?: boolean, error?: string }>}
 */
export async function speakAloud(text, options = {}) {
  const { preferElevenLabs = true, webSpeechFallback = true } = options;
  const trimmed = String(text || '').trim().slice(0, 2500);
  if (!trimmed) return { ok: true };

  const base = getBackendBase();
  const tryWeb = async () => {
    if (!webSpeechFallback) return { ok: false, error: 'ElevenLabs unavailable and speech fallback disabled' };
    try {
      await speakWithWebSpeech(trimmed);
      return { ok: true, usedWebSpeech: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  };

  if (!preferElevenLabs || !base) {
    return tryWeb();
  }

  try {
    const res = await fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed }),
    });

    const ct = res.headers.get('Content-Type') || '';
    if (!res.ok) {
      let errMsg = `Speech failed (${res.status})`;
      if (ct.includes('application/json')) {
        const j = await res.json().catch(() => ({}));
        errMsg = stringifyTranscribeError(j.error) || errMsg;
      } else {
        const t = await res.text();
        if (t) errMsg = t.slice(0, 400);
      }
      const w = await tryWeb();
      return w.ok ? { ...w, error: errMsg } : { ok: false, error: `${errMsg}; ${w.error || ''}` };
    }

    const blob = await res.blob();
    const blobType = blob.type || '';
    if (blobType.includes('json') || blob.size < 64) {
      const errTxt = await blob.text().catch(() => '');
      const w = await tryWeb();
      return w.ok ? w : { ok: false, error: errTxt.slice(0, 200) || 'Invalid TTS response' };
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playsInline = true;
    if (audio.setAttribute) audio.setAttribute('playsinline', 'true');

    try {
      await audio.play();
    } catch (playErr) {
      const name = playErr?.name || '';
      const msg = String(playErr?.message || '');
      if (name === 'NotAllowedError' || /not allowed|user gesture|interact/i.test(msg)) {
        return { ok: false, needsTap: true, objectUrl: url };
      }
      URL.revokeObjectURL(url);
      return tryWeb();
    }

    try {
      await new Promise((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Audio playback failed'));
        };
      });
      return { ok: true };
    } catch {
      return tryWeb();
    }
  } catch (e) {
    const w = await tryWeb();
    return w.ok ? { ...w, error: String(e?.message || e) } : { ok: false, error: String(e?.message || e) };
  }
}

/** @deprecated Use speakAloud — kept for imports; always allows Web Speech fallback. */
export async function speakTextWithElevenLabs(text) {
  return speakAloud(text, { preferElevenLabs: true, webSpeechFallback: true });
}

export async function transcribeAudioBlob(blob, filename = 'recording.webm') {
  const base = getBackendBase();
  const fd = new FormData();
  fd.append('file', blob, filename);
  const res = await fetch(`${base}/transcribe`, { method: 'POST', body: fd });
  const rawText = await res.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { error: rawText?.slice(0, 500) || 'Invalid JSON from transcribe endpoint' };
  }
  if (!res.ok) {
    const msg = stringifyTranscribeError(data.error) || rawText?.slice(0, 300) || `Transcription failed (${res.status})`;
    throw new Error(msg);
  }
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) throw new Error('Transcription returned empty text');
  return text;
}
