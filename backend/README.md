# Backend API (Roboflow + ElevenLabs)

Backend endpoints for Roboflow detection plus ElevenLabs transcription and text-to-speech.

## Setup

1. Preferred: use the root `.env` (single-file setup for frontend + backend), and include:

```bash
ROBOFLOW_API_KEY=your_key_here
ELEVENLABS_KEY=your_elevenlabs_key
PORT=8787
```

Alternative local-only override:

```bash
cp backend/.env.example backend/.env
```

2. Start API server:

```bash
npm run start:api
```

Server runs on `http://localhost:8787` by default.

## Endpoints

### `POST /detect`

Accepts either:

- `multipart/form-data` with file field `image`
- JSON body with `imageBase64` (or `image`) string

Returns Roboflow prediction JSON:

```json
{
  "ok": true,
  "model": "marine-trash-detection/2",
  "predictions": [],
  "raw": {}
}
```

### `POST /transcribe`

Accepts `multipart/form-data` with audio field `file`. Returns transcript JSON.

### `POST /tts`

Accepts JSON `{ "text": "..." }`. Returns `audio/mpeg`.

## Example frontend fetch (base64 JSON)

```js
const res = await fetch('http://localhost:8787/detect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ imageBase64 }), // no data URL prefix needed
});
const data = await res.json();
console.log(data.predictions);
```

## Example frontend fetch (file upload)

```js
const form = new FormData();
form.append('image', file);
const res = await fetch('http://localhost:8787/detect', {
  method: 'POST',
  body: form,
});
const data = await res.json();
console.log(data.predictions);
```
