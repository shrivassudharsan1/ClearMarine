import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.REACT_APP_GROQ_API_KEY,
  dangerouslyAllowBrowser: true,
});

/** Primary text model — default 8B instant (much lower TPD than 70B). Override: REACT_APP_GROQ_TEXT_MODEL */
const TEXT_MODEL_PRIMARY =
  process.env.REACT_APP_GROQ_TEXT_MODEL || 'llama-3.1-8b-instant';

const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

/** Fallbacks must be current Groq production IDs — see https://console.groq.com/docs/deprecations */
const TEXT_FALLBACK_8B = 'llama-3.1-8b-instant';
const TEXT_FALLBACK_70B = 'llama-3.3-70b-versatile';
const TEXT_FALLBACK_GPT_OSS = 'openai/gpt-oss-120b';

function textModelFallbackChain() {
  const primary = TEXT_MODEL_PRIMARY;
  const rest =
    primary.includes('70b') || primary.includes('gpt-oss')
      ? [TEXT_FALLBACK_8B, TEXT_FALLBACK_GPT_OSS]
      : [TEXT_FALLBACK_70B, TEXT_FALLBACK_8B, TEXT_FALLBACK_GPT_OSS];
  return [primary, ...rest].filter((m, i, a) => m && a.indexOf(m) === i);
}

async function groqTextCompletion(messages) {
  const chain = textModelFallbackChain();
  let lastErr;
  for (let i = 0; i < chain.length; i += 1) {
    const model = chain[i];
    try {
      return await groq.chat.completions.create({
        model,
        messages,
      });
    } catch (e) {
      lastErr = e;
      const code = e?.code || e?.error?.code;
      const status = e?.status;
      const msg = String(e?.message || e?.error?.message || '');
      const isRate = status === 429 || code === 'rate_limit_exceeded';
      const isDeadModel =
        status === 400 &&
        (code === 'model_decommissioned' ||
          /decommissioned|no longer supported/i.test(msg));
      if ((isRate || isDeadModel) && i < chain.length - 1) continue;
      throw e;
    }
  }
  throw lastErr;
}

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

const DEBRIS_TYPE_ENUM = 'plastic | fishing_gear | organic | chemical | mixed | unknown';

const DEBRIS_JSON_SCHEMA = `{"debris_type":"plastic","approximate_size":"hand-sized to bottle-sized","quantity_estimate":"5-20 visible pieces","spread":"concentrated","density_score":5,"density_label":"Moderate","intensity_rationale":"Score reflects multiple small plastic pieces in one cluster, no chemical release, moderate wildlife entanglement risk.","estimated_volume":"~5-20 items","confidence":"medium","needs_more_info":false,"gemini_analysis":"short factual assessment"}
Rules:
- debris_type: ${DEBRIS_TYPE_ENUM} — must align with what the reporter/photo indicates.
- approximate_size: concise phrase (e.g. "single small item", "cooler-sized clump", "several meters of line", "patch tens of meters").
- quantity_estimate: order-of-magnitude (e.g. "1", "few", "dozens", "100+", "continuous slick/line") — never fake a precise count from a vague photo.
- spread: concentrated | scattered | linear_along_shore | widespread_patch | unknown
- density_score: integer 1–10 = pollution / response intensity. You MUST quantify it from (1) hazard class of waste type, (2) physical scale from size × quantity × spread, (3) certainty of evidence. Examples: one small inert item well described → 1–3; bucket of bottles → 4–6; large ghost net or visible oil/chemical → 8–10.
- density_label: Critical (8-10) | Dense (6-7) | Moderate (3-5) | Sparse (1-2) | Unverified (only when evidence is truly absent)
- intensity_rationale: 1–3 sentences that explicitly cite waste type, size, quantity, spread, and any hazard (wildlife, navigation, chemical) to justify density_score. Do not repeat the label alone — show the reasoning.
- When structured reporter fields are provided, treat them as authoritative for scale; reconcile with photo/text and mention any conflict in gemini_analysis.
- needs_more_info: false if structured form gives type + size + quantity, OR notes give size/material/count, OR the photo is clear. true only when evidence is empty, one vague word, or unusable image.
- estimated_volume: human-readable scale ("~1 item", "small pile", "~10 m patch") or "unknown".
Respond ONLY with the JSON object, no other text.`;

function formatReporterStructuredBlock(s) {
  if (!s || typeof s !== 'object') return '';
  const lines = [];
  if (s.waste_type) lines.push(`Waste type (reporter): ${s.waste_type}`);
  if (s.size_category) lines.push(`Approx. size (reporter): ${s.size_category}`);
  if (s.quantity_band) lines.push(`Amount / count band (reporter): ${s.quantity_band}`);
  if (s.spread_layout) lines.push(`How it is spread (reporter): ${s.spread_layout}`);
  if (s.extra_notes) lines.push(`Extra reporter notes: ${s.extra_notes}`);
  if (lines.length === 0) return '';
  return `Structured reporter input:\n${lines.join('\n')}\n`;
}

// Analyze a debris photo using vision model
export async function analyzeDebrisPhoto(base64Image, mimeType, latitude, longitude, reporterStructured = null) {
  const block = formatReporterStructuredBlock(reporterStructured);
  const prompt = `You are a marine debris assessment AI.
Analyze this ocean debris photo at coordinates ${latitude}, ${longitude}.
${block ? `${block}\nUse the structured fields for scale and hazard; use the image to verify type and visible extent.\n` : ''}${DEBRIS_JSON_SCHEMA}`;

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
  return normalizeDebrisAnalysis(parsed, reporterStructured);
}

/** True when the structured form has the minimum fields for a text-only report. */
export function structuredReportComplete(s) {
  if (!s || typeof s !== 'object') return false;
  const wt = (s.waste_type || '').trim();
  const sz = (s.size_category || '').trim();
  const qb = (s.quantity_band || '').trim();
  return Boolean(wt && sz && qb);
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

function applyTextNotesHeuristic(notes, raw, reporterStructured) {
  if (structuredReportComplete(reporterStructured)) {
    return {
      ...raw,
      needs_more_info: false,
      confidence: raw.confidence === 'low' ? 'medium' : (raw.confidence || 'medium'),
    };
  }
  if (!notesLookSufficient(notes)) return raw;
  return {
    ...raw,
    needs_more_info: false,
    confidence: raw.confidence === 'low' ? 'medium' : (raw.confidence || 'medium'),
  };
}

function labelFromScore(score) {
  if (score >= 8) return 'Critical';
  if (score >= 6) return 'Dense';
  if (score >= 3) return 'Moderate';
  return 'Sparse';
}

function normalizeDebrisAnalysis(a, reporterStructured = null) {
  const conf = a.confidence === 'high' || a.confidence === 'medium' || a.confidence === 'low' ? a.confidence : 'medium';
  let score = Number(a.density_score);
  if (!Number.isFinite(score)) score = conf === 'low' ? 3 : 5;
  if (a.needs_more_info === true || conf === 'low') {
    score = Math.min(score, 4);
    if (!a.density_label || a.density_label === 'Critical' || a.density_label === 'Dense') {
      a.density_label = 'Unverified';
    }
  } else {
    const allowed = ['Critical', 'Dense', 'Moderate', 'Sparse', 'Unverified'];
    if (!allowed.includes(a.density_label)) {
      a.density_label = labelFromScore(score);
    }
  }
  if (!a.estimated_volume || String(a.estimated_volume).toLowerCase() === 'null') {
    a.estimated_volume = 'unknown';
  }
  let intensity_rationale = typeof a.intensity_rationale === 'string' ? a.intensity_rationale.trim() : '';
  if (!intensity_rationale && structuredReportComplete(reporterStructured)) {
    intensity_rationale = `Rating ${Math.round(Math.max(1, Math.min(10, score)))}/10 based on reporter: ${reporterStructured.waste_type}, ${reporterStructured.size_category}, ${reporterStructured.quantity_band}${reporterStructured.spread_layout ? `, spread: ${reporterStructured.spread_layout}` : ''}.`;
  }
  let approximate_size = typeof a.approximate_size === 'string' ? a.approximate_size.trim() : '';
  let quantity_estimate = typeof a.quantity_estimate === 'string' ? a.quantity_estimate.trim() : '';
  let spread = typeof a.spread === 'string' ? a.spread.trim() : '';
  if (reporterStructured) {
    if (!approximate_size && reporterStructured.size_category) approximate_size = reporterStructured.size_category;
    if (!quantity_estimate && reporterStructured.quantity_band) quantity_estimate = reporterStructured.quantity_band;
    if (!spread && reporterStructured.spread_layout) spread = reporterStructured.spread_layout;
  }
  return {
    ...a,
    density_score: Math.max(1, Math.min(10, Math.round(score))),
    confidence: conf,
    intensity_rationale: intensity_rationale || a.gemini_analysis?.slice(0, 200) || '',
    approximate_size: approximate_size || 'unknown',
    quantity_estimate: quantity_estimate || 'unknown',
    spread: spread || 'unknown',
  };
}

// Text-only analysis when no photo is available
export async function analyzeDebrisText(notes, latitude, longitude, reporterStructured = null) {
  const raw = (notes || '').trim();
  const block = formatReporterStructuredBlock(reporterStructured);
  const prompt = `You are a marine debris assessment AI.
Location: ${latitude}, ${longitude}
${block || ''}
Free-form description from reporter:
"${raw || 'No additional free-form description.'}"

Quantify intensity (density_score 1–10) using the structured fields as primary evidence when present; use free text for extra detail. intensity_rationale must justify the number using type, size, quantity, and spread.
${DEBRIS_JSON_SCHEMA}`;

  const response = await groqTextCompletion([{ role: 'user', content: prompt }]);
  let parsed = extractJSON(response.choices[0].message.content);
  parsed = applyTextNotesHeuristic(raw, parsed, reporterStructured);
  return normalizeDebrisAnalysis(parsed, reporterStructured);
}

/**
 * Crew assignment + interception suggestions.
 * Pass `crewRankings` as a Map<sighting_id, { ranked: [{ crewType, crewId, crewName, totalMinutes, trips, kg }] }>
 * (from src/lib/cleanupTime.rankCrewsForSighting). The model is forced to choose from the top options.
 *
 * `supplies` (optional) lets the coordinator emit a `reorder_supply` purchase order when stock is low.
 */
export async function getCrewSuggestions({
  sightings,
  vessels,
  landCrews = [],
  assignments,
  pendingHandoffs = [],
  crewRankings = null,
  supplies = [],
}) {
  const availableShips = (vessels || []).filter((v) => v.status === 'available');
  const availableLand = (landCrews || []).filter((c) => c.status === 'available');
  const lowSupplies = (supplies || []).filter((s) => s.quantity <= s.low_threshold);
  const lowSuppliesJson = JSON.stringify(lowSupplies.map((s) => ({
    id: s.id, name: s.name, zone: s.zone, quantity: s.quantity, low_threshold: s.low_threshold,
  })));

  // Compact precomputed ranking per sighting (top 3) so the model recommends the option with lowest total_minutes.
  const rankingsForPrompt = (sightings || []).map((s) => {
    const r = crewRankings && (crewRankings.get ? crewRankings.get(s.id) : crewRankings[s.id]);
    const top = (r?.ranked || []).slice(0, 3).map((opt) => ({
      crew_type: opt.crewType,
      id: opt.crewId,
      name: opt.crewName,
      total_minutes: opt.totalMinutes,
      trips: opt.trips,
      kg: Math.round(opt.kg),
    }));
    return { sighting_id: s.id, kg: r?.kg ? Math.round(r.kg) : null, top_crew_options: top };
  });

  const noOptions = rankingsForPrompt.every((r) => r.top_crew_options.length === 0);

  const prompt = `You are the AI crew coordinator for ClearMarine (one operations center; vessels and land crews below are OUR fleet).
Active debris sightings: ${JSON.stringify(sightings.map(s => ({ id: s.id, type: s.debris_type, density: s.density_label, score: s.density_score, lat: s.latitude, lon: s.longitude, status: s.status, pickup_mode: s.pickup_mode })))}
Pending handoffs to accept (this desk): ${JSON.stringify((pendingHandoffs || []).map(s => ({ handoff_id: s.id, id: s.id, from: s.source_jurisdiction, type: s.debris_type, density: s.density_label })))}
AVAILABLE ship vessels: ${JSON.stringify(availableShips.map((v) => ({ id: v.id, name: v.name, zone: v.zone, fuel: v.fuel_level })))}
AVAILABLE land crews: ${JSON.stringify(availableLand.map((c) => ({ id: c.id, name: c.name, agency: c.agency })))}
Other crews (deployed/maintenance — do NOT assign): ${JSON.stringify([
    ...((vessels || []).filter(v => v.status !== 'available').map(v => ({ name: v.name, status: v.status, kind: 'ship' }))),
    ...((landCrews || []).filter(c => c.status !== 'available').map(c => ({ name: c.name, status: c.status, kind: 'land' }))),
  ])}
Assignments: ${JSON.stringify((assignments || []).map(a => ({ vessel_id: a.vessel_id, land_crew_id: a.land_crew_id, sighting_id: a.sighting_id, status: a.status, crew_type: a.crew_type })))}
Low stock supplies (reorder_supply — use these ids for supply_id when suggesting a purchase order): ${lowSuppliesJson || '[]'}

Pre-computed crew ETA rankings per sighting (already accounts for distance, vessel speed, capacity, trips, and on-site work):
${JSON.stringify(rankingsForPrompt)}

Rules:
- For dispatch picks, you MUST choose from the corresponding sighting's top_crew_options. Recommend the option with the LOWEST total_minutes.
- If the chosen option has crew_type="ship", emit action_type "assign_vessel" with vessel_id = that option's id.
- If crew_type="land", emit action_type "assign_land_crew" with land_crew_id = that option's id.
- The text MUST name the crew, the ETA (e.g. "47 min"), the trip count, and the site kg (e.g. "Send Ocean Guardian I — 47 min, 1 trip, ~120 kg").
- Never invent a crew that isn't in top_crew_options.
- If a sighting has top_crew_options=[] (no available crew for that pickup mode), use action_type "none" and explain what's blocking. If supplies are low, prefer reorder_supply over a useless dispatch suggestion.
- reorder_supply: coordinator places an external supplier purchase order; stock is NOT immediate — ops will see an ETA. Set supply_id to a UUID from the low-stock list when possible; describe which item/zone in text.
- Prioritize highest-density sightings and shortest ETA.

Return ONLY a JSON array of exactly 3 action items, no markdown:
[
  {"text":"…","action_type":"assign_vessel","sighting_id":null,"vessel_id":null,"land_crew_id":null,"supply_id":null,"handoff_id":null},
  {"text":"…","action_type":"assign_land_crew","sighting_id":null,"vessel_id":null,"land_crew_id":null,"supply_id":null,"handoff_id":null},
  {"text":"…","action_type":"accept_handoff","sighting_id":null,"vessel_id":null,"land_crew_id":null,"supply_id":null,"handoff_id":null}
]
action_type: assign_vessel | assign_land_crew | accept_handoff | reorder_supply | mark_cleared | none`;

  const response = await groqTextCompletion([{ role: 'user', content: prompt }]);
  const raw = response.choices[0].message.content.trim();
  let items;
  try {
    items = extractJSONArray(raw);
  } catch {
    try {
      const one = extractJSON(raw);
      items = Array.isArray(one) ? one : [one];
    } catch {
      items = [{ text: raw.slice(0, 120), action_type: 'none', sighting_id: null, vessel_id: null, land_crew_id: null, supply_id: null, handoff_id: null }];
    }
  }

  if (!Array.isArray(items)) items = [items];

  // Guardrail: drop crew picks that don't match a real available option, or strip out when no options exist at all.
  const validShipIds = new Set(availableShips.map((v) => v.id));
  const validLandIds = new Set(availableLand.map((c) => c.id));
  return items.map((row) => {
    if (!row || typeof row !== 'object') return row;
    if (row.action_type === 'assign_vessel') {
      if (noOptions || !row.vessel_id || !validShipIds.has(row.vessel_id)) {
        return { ...row, action_type: 'none', vessel_id: null, text: row.text || 'No matching ship available — free a hull or pick from the dispatch list.' };
      }
    }
    if (row.action_type === 'assign_land_crew') {
      if (noOptions || !row.land_crew_id || !validLandIds.has(row.land_crew_id)) {
        return { ...row, action_type: 'none', land_crew_id: null, text: row.text || 'No matching land crew available — free a team or pick from the dispatch list.' };
      }
    }
    return row;
  });
}

// Generate jurisdiction handoff brief
export async function generateHandoffBrief({ fromAgency, toAgency, debrisType, densityLabel, densityScore, analysis, lat, lon }) {
  const prompt = `ClearMarine ops is handing this case from ${fromAgency} to ${toAgency} (partner lane — same incident system).
Location: ${lat}, ${lon}
Type: ${debrisType}, Density: ${densityScore}/10 — ${densityLabel}
Assessment: ${analysis}
Brief for the receiving coordinator: debris, risk, suggested vessel class, priority.
Max 100 words. Professional tone.`;

  const response = await groqTextCompletion([{ role: 'user', content: prompt }]);
  return response.choices[0].message.content;
}

// Crew assignment brief for a specific vessel + sighting intercept
export async function generateAssignmentBrief({ vesselName, debrisType, densityLabel, interceptionHours, lat, lon }) {
  const prompt = `Assignment brief for vessel ${vesselName}.
Intercept ${densityLabel} ${debrisType} debris in ${interceptionHours} hours at approximately ${lat.toFixed(3)}, ${lon.toFixed(3)}.
Write a concise crew briefing: equipment needed, approach instructions, safety considerations.
Max 80 words. Direct operational tone.`;

  const response = await groqTextCompletion([{ role: 'user', content: prompt }]);
  return response.choices[0].message.content;
}
