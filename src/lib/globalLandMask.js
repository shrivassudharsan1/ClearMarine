/**
 * Coarse global land mask used to clip drift forecasts so they never draw across a
 * continent. Each continent is a hand-traced ~20–45 vertex polygon following the OUTER
 * coastline (clockwise). Inland seas (Hudson Bay, Mediterranean, Black, Caspian, Sea of
 * Japan, Bay of Bengal, Caribbean, Gulf of California, Great Lakes) are intentionally
 * NOT cut out — for marine-debris drift planning we’d rather over-clip a path that tries
 * to cross those bays than under-clip and project onto land. Resolution is ~2–5°.
 *
 * Adding a new continent is a one-liner: append the polygon to LAND_POLYGONS.
 */

const NORTH_AMERICA = [
  [71, -157], [70, -141], [69, -125], [68, -110], [68, -95], [66, -82], [62, -78],
  [56, -78], [54, -64], [50, -57], [47, -53], [43, -65], [42, -70], [40, -73],
  [37, -76], [33, -78], [28, -80], [25, -81], [25, -82], [28, -83], [30, -85],
  [29, -89], [29, -94], [26, -97], [22, -97], [19, -96], [18, -94], [15, -88],
  [12, -83], [9, -82], [9, -78], [8, -79], [9, -83], [12, -87], [14, -91],
  [16, -97], [18, -103], [20, -106], [23, -107], [26, -111], [24, -110], [28, -114],
  [32, -117], [33, -118], [35, -121], [38, -123], [40, -124], [45, -124], [48, -125],
  [50, -127], [54, -131], [55, -133], [58, -136], [60, -148], [58, -158], [55, -163],
  [60, -167], [65, -168], [71, -157],
];

const SOUTH_AMERICA = [
  [12, -72], [12, -68], [10, -61], [5, -52], [-1, -49], [-5, -36], [-8, -34],
  [-13, -39], [-23, -42], [-26, -48], [-34, -54], [-40, -63], [-50, -68], [-55, -68],
  [-52, -73], [-45, -75], [-38, -73], [-30, -71], [-22, -70], [-18, -71], [-12, -77],
  [-5, -81], [2, -80], [8, -78], [10, -76], [12, -72],
];

const GREENLAND = [
  [83, -30], [82, -15], [76, -18], [70, -22], [63, -42], [60, -44], [60, -48],
  [65, -52], [70, -55], [76, -65], [80, -55], [83, -40], [83, -30],
];

// Eurasia stops at the Suez area on its south side (Africa polygon picks up there)
const EURASIA = [
  [37, -10], [44, -2], [50, -2], [52, 2], [54, 8], [56, 11], [58, 11], [62, 5],
  [70, 25], [72, 60], [75, 100], [77, 130], [70, 175], [60, 162], [55, 156],
  [50, 142], [44, 145], [42, 142], [35, 140], [30, 122], [22, 116], [16, 108],
  [10, 105], [5, 100], [1, 103], [10, 80], [8, 77], [20, 72], [24, 60], [25, 56],
  [27, 50], [16, 50], [12, 45], [24, 36], [30, 32], [36, 36], [41, 28], [44, 14],
  [42, 18], [40, 20], [40, 24], [37, -10],
];

const AFRICA = [
  [37, -10], [35, 0], [33, 11], [31, 25], [31, 33], [22, 36], [15, 40], [12, 51],
  [2, 45], [-5, 39], [-10, 40], [-25, 34], [-34, 28], [-34, 18], [-23, 14], [-15, 12],
  [-5, 9], [5, 6], [6, 0], [8, -8], [12, -16], [20, -17], [28, -10], [37, -10],
];

const AUSTRALIA = [
  [-11, 142], [-10, 145], [-15, 145], [-20, 149], [-25, 153], [-30, 153], [-37, 150],
  [-39, 146], [-39, 141], [-35, 138], [-32, 133], [-32, 125], [-34, 119], [-32, 115],
  [-25, 113], [-20, 119], [-16, 124], [-14, 130], [-12, 135], [-11, 142],
];

const NEW_GUINEA = [
  [-1, 131], [-2, 137], [-4, 141], [-6, 144], [-9, 147], [-10, 150], [-9, 145],
  [-7, 140], [-3, 134], [-1, 131],
];

const JAPAN = [
  [45, 142], [44, 145], [42, 142], [37, 141], [34, 137], [33, 132], [31, 130],
  [33, 130], [35, 133], [36, 136], [38, 139], [40, 140], [41, 141], [43, 145], [45, 142],
];

const MADAGASCAR = [
  [-12, 49], [-15, 50], [-18, 49], [-22, 47], [-25, 47], [-25, 45], [-22, 43],
  [-18, 44], [-13, 47], [-12, 49],
];

const NEW_ZEALAND = [
  [-34, 173], [-37, 175], [-39, 178], [-42, 178], [-46, 169], [-47, 167], [-44, 168],
  [-41, 173], [-37, 174], [-34, 173],
];

const ICELAND = [
  [66, -23], [66, -14], [64, -14], [63, -17], [63, -22], [65, -24], [66, -23],
];

const BRITISH_ISLES = [
  [60, -2], [58, -3], [55, -2], [53, 1], [51, 1], [50, -3], [50, -5], [54, -10],
  [55, -8], [58, -7], [60, -2],
];

export const LAND_POLYGONS = [
  NORTH_AMERICA,
  SOUTH_AMERICA,
  GREENLAND,
  EURASIA,
  AFRICA,
  AUSTRALIA,
  NEW_GUINEA,
  JAPAN,
  MADAGASCAR,
  NEW_ZEALAND,
  ICELAND,
  BRITISH_ISLES,
];

/** Antarctic polar mask — south of ~−60° we treat the entire ring as land/ice. */
const ANTARCTIC_LAT_LIMIT = -60;

function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [latI, lonI] = poly[i];
    const [latJ, lonJ] = poly[j];
    const denom = latJ - latI;
    if (denom === 0) continue;
    const intersect = ((latI > lat) !== (latJ > lat))
      && (lon < ((lonJ - lonI) * (lat - latI)) / denom + lonI);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * True if (lat, lon) falls inside any continent / large island polygon, or south of the
 * Antarctic polar mask. False for ocean and small islands not in the mask. False for
 * non-finite inputs (so callers can safely pass partial drift rows).
 */
export function isOnGlobalLand(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat <= ANTARCTIC_LAT_LIMIT) return true;
  for (let i = 0; i < LAND_POLYGONS.length; i += 1) {
    if (pointInPolygon(lat, lon, LAND_POLYGONS[i])) return true;
  }
  return false;
}

/**
 * Walk a geodesic between two points and return the fraction t∈[0,1] of the first
 * water→land transition along the segment, or null if the whole segment stays in water.
 * Uses straight-line lat/lon interpolation (good enough at our coarse mask resolution).
 */
/**
 * Return the nearest point on any coastline polygon to (lat, lon), as [shoreLat, shoreLon].
 * Uses straight-line distance in lat/lon space (good enough at our coarse mask resolution).
 * Returns null if there are no polygons in range.
 */
export function nearestPolygonShorePoint(lat, lon) {
  let best = null;
  let bestSq = Infinity;
  for (let p = 0; p < LAND_POLYGONS.length; p += 1) {
    const poly = LAND_POLYGONS[p];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      // Project (lat, lon) onto segment a→b in flat lat/lon space.
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : ((lat - a[0]) * dx + (lon - a[1]) * dy) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const projLat = a[0] + t * dx;
      const projLon = a[1] + t * dy;
      const dLat = lat - projLat;
      const dLon = lon - projLon;
      const sq = dLat * dLat + dLon * dLon;
      if (sq < bestSq) {
        bestSq = sq;
        best = [projLat, projLon];
      }
    }
  }
  return best;
}

export function firstLandContactFraction(aLat, aLon, bLat, bLon, steps = 48) {
  if (isOnGlobalLand(aLat, aLon)) return 0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const lat = aLat + t * (bLat - aLat);
    const lon = aLon + t * (bLon - aLon);
    if (!isOnGlobalLand(lat, lon)) continue;
    let lo = (i - 1) / steps;
    let hi = t;
    for (let k = 0; k < 14; k += 1) {
      const mid = (lo + hi) / 2;
      const mLat = aLat + mid * (bLat - aLat);
      const mLon = aLon + mid * (bLon - aLon);
      if (isOnGlobalLand(mLat, mLon)) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  return null;
}
