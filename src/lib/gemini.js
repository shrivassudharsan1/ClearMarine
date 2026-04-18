import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.REACT_APP_GROQ_API_KEY,
  dangerouslyAllowBrowser: true,
});

const TEXT_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in response');
  return JSON.parse(text.slice(start, end + 1));
}

function extractJSONArray(text) {
  const t = text.trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON array found in response');
  return JSON.parse(t.slice(start, end + 1));
}

const DEBRIS_JSON_SCHEMA = `{"debris_type":"plastic","density_score":4,"density_label":"Moderate","estimated_volume":"unknown","confidence":"medium","needs_more_info":false,"gemini_analysis":"short factual assessment"}
Rules:
- debris_type: plastic | fishing_gear | organic | chemical | mixed | unknown
- density_label: Critical (8-10) | Dense (6-7) | Moderate (3-5) | Sparse (1-2) | Unverified (only when evidence is truly absent)
- TEXT REPORTS: Read the reporter's words carefully. If they state size, material, and/or amount (including patterns like "size: small", "material: metal", "amount: 1", "one plastic bottle", "small net"), that IS sufficient detail — set needs_more_info false and assign a reasonable debris_type and moderate severity unless they describe a large patch or chemical hazard.
- Set needs_more_info true ONLY when notes are empty, a single vague word (e.g. "trash"), or no describable object — not when size/material/count are given.
- Photos: if image is unreadable/blurry, needs_more_info may be true; if clear, needs_more_info false.
- Do NOT invent exact weights; estimated_volume can be "~1 item", "small pile", or "unknown" when not inferable.
- severity must match stated scope (one small item → lower scores; large accumulation → higher).
Respond ONLY with the JSON object, no other text.`;

// Analyze a debris photo using vision model
export async function analyzeDebrisPhoto(base64Image, mimeType, latitude, longitude) {
  const prompt = `You are a marine debris assessment AI.
Analyze this ocean debris photo at coordinates ${latitude}, ${longitude}.
${DEBRIS_JSON_SCHEMA}`;

  const response = await groq.chat.completions.create({
    model: VISION_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const parsed = extractJSON(response.choices[0].message.content);
  return normalizeDebrisAnalysis(parsed);
}

/** Detect when plain-text notes already contain enough structure (size/material/amount) so we don't block the user. */
export function notesLookSufficient(notes) {
  const t = (notes || '').trim();
  if (t.length < 6) return false;
  let hits = 0;
  if (/\bsize\s*[:=]|\b(size|approx\.?|about|diameter|length)\b|(^|[\s,])\s*(tiny|small|medium|large|huge)\b|\d+\s*(cm|m|mm|ft|in|inch|inches|meters?)\b|\d+\s*x\s*\d+/i.test(t)) hits += 1;
  if (/\bmaterial\s*[:=]|\b(plastic|metal|glass|wood|styrofoam|foam|rope|net|nets|fabric|rubber|aluminum|aluminium|paper|cardboard|mixed)\b/i.test(t)) hits += 1;
  if (/\bamount\s*[:=]|\b(amount|quantity|count|pieces?|bottles?|cans?|bags?|items?)\b|\b(one|two|three|four|five|several|many|few|single|couple|\d+)\b/i.test(t)) hits += 1;
  if (hits >= 2) return true;
  if (t.length >= 40 && hits >= 1) return true;
  return false;
}

function applyTextNotesHeuristic(notes, raw) {
  if (!notesLookSufficient(notes)) return raw;
  return {
    ...raw,
    needs_more_info: false,
    confidence: raw.confidence === 'low' ? 'medium' : (raw.confidence || 'medium'),
  };
}

function normalizeDebrisAnalysis(a) {
  const conf = a.confidence === 'high' || a.confidence === 'medium' || a.confidence === 'low' ? a.confidence : 'medium';
  let score = Number(a.density_score);
  if (!Number.isFinite(score)) score = conf === 'low' ? 3 : 5;
  if (a.needs_more_info === true || conf === 'low') {
    score = Math.min(score, 4);
    if (!a.density_label || a.density_label === 'Critical' || a.density_label === 'Dense') {
      a.density_label = 'Unverified';
    }
  }
  if (!a.estimated_volume || String(a.estimated_volume).toLowerCase() === 'null') {
    a.estimated_volume = 'unknown';
  }
  return { ...a, density_score: Math.max(1, Math.min(10, Math.round(score))), confidence: conf };
}

// Text-only analysis when no photo is available
export async function analyzeDebrisText(notes, latitude, longitude) {
  const raw = (notes || '').trim();
  const prompt = `You are a marine debris assessment AI.
A reporter at coordinates ${latitude}, ${longitude} described this debris sighting:
"${raw || 'No description provided'}"
Use every detail they gave (object type, size words, material, count). If they gave size OR material OR amount, the description is not "empty" — set needs_more_info false unless there is truly nothing to assess.
${DEBRIS_JSON_SCHEMA}`;

  const response = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  let parsed = extractJSON(response.choices[0].message.content);
  parsed = applyTextNotesHeuristic(raw, parsed);
  return normalizeDebrisAnalysis(parsed);
}

// Crew assignment + interception suggestions
export async function getCrewSuggestions({ sightings, vessels, assignments, pendingHandoffs = [] }) {
  const available = (vessels || []).filter((v) => v.status === 'available');
  const availJson = JSON.stringify(available.map((v) => ({
    id: v.id, name: v.name, zone: v.zone, fuel: v.fuel_level, capacity: v.capacity,
  })));

  const prompt = `You are the AI crew coordinator for ClearMarine (one operations center; vessels below are OUR fleet).
Active debris sightings: ${JSON.stringify(sightings.map(s => ({ id: s.id, type: s.debris_type, density: s.density_label, score: s.density_score, lat: s.latitude, lon: s.longitude, status: s.status })))}
Pending handoffs to accept (this desk): ${JSON.stringify((pendingHandoffs || []).map(s => ({ handoff_id: s.id, id: s.id, from: s.source_jurisdiction, type: s.debris_type, density: s.density_label })))}
AVAILABLE vessels (status=available — ONLY these can be assigned; you MUST pick one by name and id): ${availJson || '[]'}
Other vessels (deployed/maintenance — do NOT assign): ${JSON.stringify((vessels || []).filter(v => v.status !== 'available').map(v => ({ name: v.name, status: v.status })))}
Assignments: ${JSON.stringify(assignments.map(a => ({ vessel_id: a.vessel_id, sighting_id: a.sighting_id, status: a.status })))}

Rules:
- For assign_vessel: text MUST name the exact vessel (e.g. "Send Ocean Guardian I to intercept…") and set vessel_id to that vessel's UUID from AVAILABLE list only.
- If AVAILABLE is empty: do NOT use assign_vessel. Use action_type "none" with text explaining no hulls are ready (suggest freeing a vessel or waiting). Optionally suggest reorder_supply if supplies are low.
- Prioritize highest-density sightings and nearest zone match to the debris lat/lon.

Return ONLY a JSON array of exactly 3 action items, no markdown:
[
  {"text":"Send [VESSEL NAME] to …","action_type":"assign_vessel","sighting_id":null,"vessel_id":null,"supply_id":null,"handoff_id":null},
  {"text":"…","action_type":"accept_handoff","sighting_id":null,"vessel_id":null,"supply_id":null,"handoff_id":null},
  {"text":"…","action_type":"reorder_supply","sighting_id":null,"vessel_id":null,"supply_id":null,"handoff_id":null}
]
action_type: assign_vessel | accept_handoff | reorder_supply | mark_cleared | none
Set sighting_id, vessel_id, handoff_id from the data above when relevant.`;

  const response = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = response.choices[0].message.content.trim();
  let items;
  try {
    items = extractJSONArray(raw);
  } catch {
    try {
      const one = extractJSON(raw);
      items = Array.isArray(one) ? one : [one];
    } catch {
      items = [{ text: raw.slice(0, 120), action_type: 'none', sighting_id: null, vessel_id: null, supply_id: null, handoff_id: null }];
    }
  }

  if (!Array.isArray(items)) items = [items];
  if (available.length === 0) {
    return items.map((row) => {
      if (row && row.action_type === 'assign_vessel') {
        return {
          ...row,
          action_type: 'none',
          vessel_id: null,
          text: 'No cleanup vessels are available — free a hull from deployment/maintenance or wait for a returning crew before assigning.',
        };
      }
      return row;
    });
  }
  return items;
}

// Generate jurisdiction handoff brief
export async function generateHandoffBrief({ fromAgency, toAgency, debrisType, densityLabel, densityScore, analysis, lat, lon }) {
  const prompt = `ClearMarine ops is handing this case from ${fromAgency} to ${toAgency} (partner lane — same incident system).
Location: ${lat}, ${lon}
Type: ${debrisType}, Density: ${densityScore}/10 — ${densityLabel}
Assessment: ${analysis}
Brief for the receiving coordinator: debris, risk, suggested vessel class, priority.
Max 100 words. Professional tone.`;

  const response = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.choices[0].message.content;
}

// Crew assignment brief for a specific vessel + sighting intercept
export async function generateAssignmentBrief({ vesselName, debrisType, densityLabel, interceptionHours, lat, lon }) {
  const prompt = `Assignment brief for vessel ${vesselName}.
Intercept ${densityLabel} ${debrisType} debris in ${interceptionHours} hours at approximately ${lat.toFixed(3)}, ${lon.toFixed(3)}.
Write a concise crew briefing: equipment needed, approach instructions, safety considerations.
Max 80 words. Direct operational tone.`;

  const response = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.choices[0].message.content;
}
