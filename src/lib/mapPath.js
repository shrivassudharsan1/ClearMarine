/**
 * Great-circle densification for Leaflet polylines — avoids the "long way around"
 * straight segment in lon/lat when two points span the Pacific or wrap oddly.
 */

function normalizeLon(lon) {
  let L = ((lon + 180) % 360 + 360) % 360 - 180;
  return L;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lat2 - lat1) * Math.PI) / 180;
  const dg = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dl / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Shortest-path great circle from p1 to p2; enough vertices for smooth maps on world zoom.
 * @param {[number, number]} p1 [lat, lon]
 * @param {[number, number]} p2
 * @returns {[number, number][] lon normalized to (-180, 180]
 */
export function greatCircleLatLngs(p1, p2) {
  const [lat1, lon1] = p1;
  const [lat2, lon2] = p2;
  const φ1 = (lat1 * Math.PI) / 180;
  const λ1 = (normalizeLon(lon1) * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const λ2 = (normalizeLon(lon2) * Math.PI) / 180;

  const cosD = Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const d = Math.acos(Math.min(1, Math.max(-1, cosD)));
  if (!Number.isFinite(d) || d < 1e-8) {
    return [
      [lat1, normalizeLon(lon1)],
      [lat2, normalizeLon(lon2)],
    ];
  }

  const distKm = haversineKm(lat1, normalizeLon(lon1), lat2, normalizeLon(lon2));
  const n = distKm < 120 ? 2 : Math.min(96, Math.max(12, Math.ceil(distKm / 200)));

  const out = [[lat1, normalizeLon(lon1)]];
  for (let i = 1; i < n; i += 1) {
    const f = i / n;
    const s1 = Math.sin((1 - f) * d) / Math.sin(d);
    const s2 = Math.sin(f * d) / Math.sin(d);
    const x = s1 * Math.cos(φ1) * Math.cos(λ1) + s2 * Math.cos(φ2) * Math.cos(λ2);
    const y = s1 * Math.cos(φ1) * Math.sin(λ1) + s2 * Math.cos(φ2) * Math.sin(λ2);
    const z = s1 * Math.sin(φ1) + s2 * Math.sin(φ2);
    const φi = Math.atan2(z, Math.hypot(x, y));
    const λi = Math.atan2(y, x);
    out.push([(φi * 180) / Math.PI, normalizeLon((λi * 180) / Math.PI)]);
  }
  out.push([lat2, normalizeLon(lon2)]);
  return out;
}

/**
 * One polyline per logical leg (24h / 48h / 72h), vertices along shortest ocean arc.
 */
export function driftSegmentsForMap(pathPoints) {
  if (!pathPoints || pathPoints.length < 2) return [];
  const colors = ['#eab308', '#f97316', '#ef4444'];
  const segs = [];
  for (let i = 0; i < pathPoints.length - 1; i += 1) {
    const positions = greatCircleLatLngs(pathPoints[i], pathPoints[i + 1]);
    segs.push({
      positions,
      color: colors[Math.min(i, 2)],
    });
  }
  return segs;
}
