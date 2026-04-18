import { supabase } from './supabase';
import { getNearestGliderCurrent } from './gliderCurrents';

// Cache so the same lat/lon doesn't hit Supabase twice per session
const currentCache = new Map();

function displaceLatLon(lat, lon, km, bearing) {
  const R = 6371;
  const d = km / R;
  const rad = (bearing * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(rad));
  const lon2 = lon1 + Math.atan2(Math.sin(rad) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

// Gyre-based fallback used only when HYCOM data isn't seeded yet
function gyroFallback(lat, lon) {
  if (lat > 0) {
    if (lon < -100 && lat < 45) return { speed: 1.8, bearing: 280, source: 'fallback' };
    return { speed: 1.5, bearing: 60, source: 'fallback' };
  }
  return { speed: 1.2, bearing: 200, source: 'fallback' };
}

// Snap to the nearest 5° grid point (matches seed_currents.js grid resolution)
function snapToGrid(val, step = 5) {
  return Math.round(val / step) * step;
}

/** Resolve surface current: prefer nearby Spray/CORC glider observation, else HYCOM grid, else gyre fallback. */
async function resolveCurrentForDrift(lat, lon) {
  const glider = await getNearestGliderCurrent(lat, lon);
  if (glider) {
    return {
      speed: glider.speed,
      bearing: glider.bearing,
      source: glider.source,
    };
  }

  const hycom = await fetchCurrentFromDB(lat, lon);
  if (hycom) {
    return {
      speed: hycom.speed,
      bearing: hycom.bearing,
      source: hycom.source,
    };
  }

  const fb = gyroFallback(lat, lon);
  return {
    speed: fb.speed,
    bearing: fb.bearing,
    source: `${fb.source} (model; seed DB or add CORC index)`,
  };
}

async function fetchCurrentFromDB(lat, lon) {
  const snappedLat = snapToGrid(Math.max(-80, Math.min(80, lat)));
  const snappedLon = snapToGrid(lon);
  const cacheKey = `${snappedLat},${snappedLon}`;

  if (currentCache.has(cacheKey)) return currentCache.get(cacheKey);

  // Find nearest grid point within 8 degrees (handles edge cases)
  const { data, error } = await supabase
    .from('ocean_currents')
    .select('speed_knots, bearing, source, recorded_at')
    .gte('lat', snappedLat - 8)
    .lte('lat', snappedLat + 8)
    .gte('lon', snappedLon - 8)
    .lte('lon', snappedLon + 8)
    .order('lat', { ascending: true })
    .limit(1);

  if (error || !data || data.length === 0) return null;

  const current = {
    speed: data[0].speed_knots,
    bearing: data[0].bearing,
    source: `NOAA HYCOM (${data[0].recorded_at?.slice(0, 10)})`,
  };
  currentCache.set(cacheKey, current);
  return current;
}

export async function predictDrift(lat, lon) {
  const current = await resolveCurrentForDrift(lat, lon);
  if (current.source.includes('fallback')) {
    console.warn('Drift using gyre fallback — seed ocean_currents or ensure /data/corc_glider_index.json');
  }

  const speedKmh = current.speed * 1.852;
  const wobble = (Math.random() - 0.5) * 8; // ±4° directional uncertainty

  const predictions = [24, 48, 72].map((h) => {
    const km = speedKmh * h;
    const bearing = (current.bearing + wobble * (h / 24) + 360) % 360;
    return { hours: h, ...displaceLatLon(lat, lon, km, bearing) };
  });

  return { speed: current.speed, bearing: current.bearing, source: current.source, predictions };
}

export async function getInterceptionPoint(sightingLat, sightingLon, vesselLat, vesselLon) {
  const drift = await predictDrift(sightingLat, sightingLon);
  let best = null;
  let bestDist = Infinity;
  for (const pt of drift.predictions) {
    const d = Math.hypot(pt.lat - vesselLat, pt.lon - vesselLon);
    if (d < bestDist) { bestDist = d; best = pt; }
  }
  return best;
}
