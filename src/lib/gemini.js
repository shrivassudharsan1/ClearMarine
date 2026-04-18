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

const DEBRIS_JSON_SCHEMA = `{"debris_type":"plastic","density_score":4,"density_label":"Moderate","estimated_volume":"unknown","confidence":"low","needs_more_info":true,"gemini_analysis":"short factual assessment; say what is unknown if evidence is weak"}
Rules:
- debris_type: plastic | fishing_gear | organic | chemical | mixed | unknown
- density_label: Critical (8-10) | Dense (6-7) | Moderate (3-5) | Sparse (1-2) | Unverified (use when confidence is not high)
- If the photo is unclear, or text notes are vague/empty, set confidence "low", needs_more_info true, density_label "Unverified", density_score 2-3, estimated_volume "unknown", debris_type "unknown" unless clearly stated.
- Do NOT invent specific weights, dimensions, or volume. Use estimated_volume "unknown" unless you have a clear visual or textual basis; optional "~X" only with strong evidence.
- severity (density_score) must align with visible/text evidence; when uncertain keep score ≤4.
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
If the description lacks size, material, amount, or hazard detail, set needs_more_info true and confidence low; do not guess volume or high severity.
${DEBRIS_JSON_SCHEMA}`;

  const response = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = extractJSON(response.choices[0].message.content);
  return normalizeDebrisAnalysis(parsed);
}

// Crew assignment + interception suggestions
export async function getCrewSuggestions({ sightings, vessels, assignments, pendingHandoffs = [] }) {
  const prompt = `You are an ocean debris coordination AI for a cleanup agency.
Active debris sightings: ${JSON.stringify(sightings.map(s => ({ id: s.id, type: s.debris_type, density: s.density_label, score: s.density_score, lat: s.latitude, lon: s.longitude, status: s.status })))}
Pending jurisdiction handoffs (for THIS agency to accept — use these ids for accept_handoff): ${JSON.stringify((pendingHandoffs || []).map(s => ({ handoff_id: s.id, id: s.id, from: s.source_jurisdiction, type: s.debris_type, density: s.density_label })))}
Available vessels: ${JSON.stringify(vessels.map(v => ({ id: v.id, name: v.name, zone: v.zone, status: v.status, fuel: v.fuel_level, capacity: v.capacity })))}
Current assignments: ${JSON.stringify(assignments.map(a => ({ vessel_id: a.vessel_id, sighting_id: a.sighting_id, status: a.status })))}

Return ONLY a JSON array of exactly 3 action items, no markdown:
[
  {"text":"action description max 20 words","action_type":"assign_vessel","sighting_id":null,"vessel_id":null,"supply_id":null,"handoff_id":null},
  {"text":"action description","action_type":"accept_handoff","sighting_id":null,"vessel_id":null,"supply_id":null,"handoff_id":null},
  {"text":"action description","action_type":"reorder_supply","sighting_id":null,"vessel_id":null,"supply_id":null,"handoff_id":null}
]
action_type must be one of: assign_vessel, accept_handoff, reorder_supply, mark_cleared, none
Set relevant _id fields to actual UUIDs from the data above. For accept_handoff set handoff_id to the pending handoff sighting id. If there are no pending handoffs, use action_type none or another relevant action. Prioritize critical density sightings and low fuel vessels.`;

  const response = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = response.choices[0].message.content.trim();
  try {
    return extractJSONArray(raw);
  } catch {
    try {
      const one = extractJSON(raw);
      return Array.isArray(one) ? one : [one];
    } catch {
      return [{ text: raw.slice(0, 120), action_type: 'none', sighting_id: null, vessel_id: null, supply_id: null, handoff_id: null }];
    }
  }
}

// Generate jurisdiction handoff brief
export async function generateHandoffBrief({ fromAgency, toAgency, debrisType, densityLabel, densityScore, analysis, lat, lon }) {
  const prompt = `Debris cluster being handed off from ${fromAgency} to ${toAgency}.
Location: ${lat}, ${lon}
Type: ${debrisType}, Density: ${densityScore}/10 — ${densityLabel}
Assessment: ${analysis}
Generate a concise jurisdiction handoff brief for the receiving agency coordinator.
Include: debris description, environmental risk, recommended vessel type, priority level.
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
