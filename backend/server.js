const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const dotenv = require('dotenv');
const path = require('path');

// Load backend-specific env (do not rely on CRA's .env)
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = Number(process.env.PORT || 8787);
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
const ROBOFLOW_API_URL = 'https://serverless.roboflow.com';
const MODEL_ID = 'marine-trash-detection/2';
const ELEVENLABS_KEY = process.env.ELEVENLABS_KEY;
const ELEVENLABS_STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';
/** Optional ISO language hint for Scribe (e.g. en). Leave unset if your API version ignores it. */
const ELEVENLABS_STT_LANGUAGE = (process.env.ELEVENLABS_STT_LANGUAGE || '').trim();
/** Default premade voice (Rachel). Override with ELEVENLABS_VOICE_ID from your ElevenLabs Voices page. */
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00TcmT4DvrzdWaoCl6';
/** Multilingual v2 works with default premade voices; override if your account requires another model. */
const ELEVENLABS_TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2';

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    services: ['roboflow-proxy', 'elevenlabs-stt', 'elevenlabs-tts'],
    elevenlabs_key_configured: Boolean(ELEVENLABS_KEY),
    elevenlabs_tts_voice_id: ELEVENLABS_VOICE_ID,
  });
});

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'clearmarine-api',
    message: 'POST /detect (Roboflow), POST /transcribe (multipart file), POST /tts JSON { text } (ElevenLabs TTS).',
  });
});

function stripDataUrlPrefix(input) {
  const s = String(input || '').trim();
  const comma = s.indexOf(',');
  if (s.startsWith('data:') && comma > -1) return s.slice(comma + 1);
  return s;
}

function getBase64FromRequest(req) {
  if (req.file && req.file.buffer) {
    return req.file.buffer.toString('base64');
  }
  if (req.body && (req.body.imageBase64 || req.body.image)) {
    return stripDataUrlPrefix(req.body.imageBase64 || req.body.image);
  }
  return '';
}

app.post('/detect', upload.single('image'), async (req, res) => {
  try {
    if (!ROBOFLOW_API_KEY) {
      return res.status(500).json({ error: 'Missing ROBOFLOW_API_KEY in environment' });
    }

    const imageBase64 = getBase64FromRequest(req);
    if (!imageBase64) {
      return res.status(400).json({
        error: 'No image provided. Send multipart file field "image" or JSON { imageBase64 }',
      });
    }
    // eslint-disable-next-line no-console
    console.log(`[roboflow-proxy] /detect image bytes(base64)=${imageBase64.length}`);

    const endpoint = `${ROBOFLOW_API_URL}/${MODEL_ID}?api_key=${encodeURIComponent(ROBOFLOW_API_KEY)}`;
    // Roboflow serverless expects base64 as the request body (x-www-form-urlencoded)
    // See: detect.roboflow.com examples (same payload style).
    const body = imageBase64;

    const rf = await axios.post(endpoint, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
      maxBodyLength: Infinity,
    });
    // eslint-disable-next-line no-console
    console.log(`[roboflow-proxy] roboflow status=${rf.status} predictions=${rf.data?.predictions?.length ?? 0}`);

    return res.json({
      ok: true,
      model: MODEL_ID,
      predictions: rf.data?.predictions || [],
      raw: rf.data,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    // eslint-disable-next-line no-console
    console.warn('[roboflow-proxy] error', status, err.response?.data || err.message);
    return res.status(status).json({
      ok: false,
      error: err.response?.data || err.message || 'Roboflow request failed',
    });
  }
});

/**
 * ElevenLabs Speech-to-Text (Scribe) — multipart field "file".
 * Docs: POST https://api.elevenlabs.io/v1/speech-to-text
 */
app.post('/transcribe', upload.single('file'), async (req, res) => {
  try {
    if (!ELEVENLABS_KEY) {
      return res.status(500).json({ error: 'Missing ELEVENLABS_KEY in backend/.env' });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio file. Send multipart field "file".' });
    }

    const fd = new FormData();
    fd.append('file', req.file.buffer, {
      filename: req.file.originalname || 'recording.webm',
      contentType: req.file.mimetype || 'application/octet-stream',
    });
    fd.append('model_id', ELEVENLABS_STT_MODEL);
    if (ELEVENLABS_STT_LANGUAGE) {
      fd.append('language_code', ELEVENLABS_STT_LANGUAGE);
    }

    const el = await axios.post('https://api.elevenlabs.io/v1/speech-to-text', fd, {
      headers: {
        ...fd.getHeaders(),
        'xi-api-key': ELEVENLABS_KEY,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120000,
    });

    const text = typeof el.data?.text === 'string' ? el.data.text.trim() : '';
    if (!text) {
      return res.status(502).json({ error: 'ElevenLabs returned empty transcript', raw: el.data });
    }
    return res.json({ ok: true, text, model_id: ELEVENLABS_STT_MODEL });
  } catch (err) {
    const status = err.response?.status || 500;
    // eslint-disable-next-line no-console
    console.warn('[elevenlabs-stt] error', status, err.response?.data || err.message);
    return res.status(status).json({
      ok: false,
      error: err.response?.data || err.message || 'ElevenLabs transcription failed',
    });
  }
});

/**
 * ElevenLabs text-to-speech — JSON body { "text": "..." } returns audio/mpeg.
 * https://elevenlabs.io/docs/api-reference/text-to-speech
 */
app.post('/tts', async (req, res) => {
  try {
    if (!ELEVENLABS_KEY) {
      return res.status(500).json({ error: 'Missing ELEVENLABS_KEY in backend/.env' });
    }
    const text = String(req.body?.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Missing JSON body field "text"' });
    }
    if (text.length > 2500) {
      return res.status(400).json({ error: 'Text exceeds 2500 characters' });
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_VOICE_ID)}`;
    const el = await axios.post(
      url,
      {
        text,
        model_id: ELEVENLABS_TTS_MODEL,
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        responseType: 'arraybuffer',
        timeout: 120000,
        maxBodyLength: Infinity,
      },
    );

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(el.data));
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data;
    let message = err.message || 'TTS failed';
    if (Buffer.isBuffer(detail)) {
      message = detail.toString('utf8').slice(0, 500);
    } else if (detail && typeof detail === 'object') {
      message = JSON.stringify(detail).slice(0, 500);
    }
    // eslint-disable-next-line no-console
    console.warn('[elevenlabs-tts] error', status, message);
    return res.status(status).json({
      ok: false,
      error: message,
    });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ClearMarine API listening on http://localhost:${PORT} (Roboflow + ElevenLabs STT/TTS)`);
});
