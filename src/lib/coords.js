/**
 * Display and parse lat/lon with correct N/S and E/W hemispheres.
 */

export function formatCoordPair(lat, lng) {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return '—';
  const ns = lat >= 0 ? `${lat.toFixed(4)}°N` : `${Math.abs(lat).toFixed(4)}°S`;
  const ew = lng >= 0 ? `${lng.toFixed(4)}°E` : `${Math.abs(lng).toFixed(4)}°W`;
  return `${ns}, ${ew}`;
}

/**
 * Manual longitude: unsigned values follow E/W toggle; leading + / - still wins.
 * @param {string} str - user input
 * @param {'E'|'W'} hemisphereEW - when value is unsigned
 */
export function parseManualLongitude(str, hemisphereEW) {
  const t = (str || '').trim();
  const v = parseFloat(t);
  if (!Number.isFinite(v)) return NaN;
  if (t.startsWith('-')) return v;
  if (t.startsWith('+')) return hemisphereEW === 'E' ? Math.abs(v) : -Math.abs(v);
  return hemisphereEW === 'E' ? Math.abs(v) : -Math.abs(v);
}
