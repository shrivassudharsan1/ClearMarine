/**
 * Nearest Spray/CORC glider depth-mean current from prebuilt public index (see scripts/build_corc_glider_json.py).
 */

let indexCache = null;
let indexLoadFailed = false;

/** 1° grid buckets: key "lat_lon" -> profile indices */
function buildBuckets(profiles) {
  const buckets = new Map();
  for (let i = 0; i < profiles.length; i += 1) {
    const p = profiles[i];
    const key = `${Math.floor(p.lat)}_${Math.floor(p.lon)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  return buckets;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadIndex() {
  if (indexLoadFailed) return null;
  if (indexCache) return indexCache;
  try {
    const base = process.env.PUBLIC_URL || '';
    const res = await fetch(`${base}/data/corc_glider_index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    indexCache = await res.json();
    return indexCache;
  } catch (e) {
    console.warn('Glider index not loaded:', e.message);
    indexLoadFailed = true;
    return null;
  }
}

/**
 * If a CORC profile exists within max_km of (lat,lon), return current vector for drift.
 * @returns {Promise<{ speed: number, bearing: number, source: string, distance_km?: number } | null>}
 */
export async function getNearestGliderCurrent(lat, lon) {
  const data = await loadIndex();
  if (!data?.profiles?.length) return null;
  const maxKm = typeof data.max_km_glider_priority === 'number' ? data.max_km_glider_priority : 120;

  const { profiles } = data;
  if (!data._buckets) {
    data._buckets = buildBuckets(profiles);
  }
  const buckets = data._buckets;

  let best = null;
  let bestD = Infinity;
  const ilat = Math.floor(lat);
  const ilon = Math.floor(lon);
  for (let da = -2; da <= 2; da += 1) {
    for (let db = -2; db <= 2; db += 1) {
      const key = `${ilat + da}_${ilon + db}`;
      const idxs = buckets.get(key);
      if (!idxs) continue;
      for (let k = 0; k < idxs.length; k += 1) {
        const p = profiles[idxs[k]];
        const d = haversineKm(lat, lon, p.lat, p.lon);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
  }

  if (bestD === Infinity) {
    for (let i = 0; i < profiles.length; i += 1) {
      const p = profiles[i];
      const d = haversineKm(lat, lon, p.lat, p.lon);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }

  if (!best || bestD > maxKm) return null;

  return {
    speed: best.speed_knots,
    bearing: best.bearing_deg,
    source: `Spray glider CORC (nearest ~${bestD.toFixed(0)} km; depth-mean u,v)`,
    distance_km: bestD,
  };
}
