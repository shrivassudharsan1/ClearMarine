/**
 * Crude Pacific coast model: west (more negative lon) = offshore, east = inland.
 * Used only to decide if the drift polyline crosses toward shore — not survey-grade.
 */

function pacificCoastLon(lat) {
  if (lat >= 32 && lat <= 50) {
    return -117 - ((lat - 32) / 18) * 7.5;
  }
  if (lat >= 22 && lat < 32) {
    return -110 - ((lat - 22) / 10) * 7;
  }
  return null;
}

function isOffshorePacific(lat, lon) {
  const cl = pacificCoastLon(lat);
  if (cl == null) return false;
  return lon < cl - 0.04;
}

/** Interpolate first point along A→B that is no longer clearly offshore (shore approach / land). */
function interpolateShoreCrossing(lat0, lon0, lat1, lon1) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    const lat = lat0 + mid * (lat1 - lat0);
    const lon = lon0 + mid * (lon1 - lon0);
    if (!isOffshorePacific(lat, lon)) hi = mid;
    else lo = mid;
  }
  const t = hi;
  return [lat0 + t * (lat1 - lat0), lon0 + t * (lon1 - lon0)];
}

/**
 * @returns {{
 *   showLandfallFlag: boolean,
 *   landfallPoint: [number, number] | null,
 *   pathPoints: [number, number][],
 *   landfallLabel: string | null,
 * }}
 */
export function computePacificLandfallDisplay(originLat, originLon, drift) {
  if (!drift) {
    return { showLandfallFlag: false, landfallPoint: null, pathPoints: [], landfallLabel: null };
  }

  const pts = [
    [originLat, originLon],
    [drift.lat_24h, drift.lon_24h],
    [drift.lat_48h, drift.lon_48h],
    [drift.lat_72h, drift.lon_72h],
  ];

  const startOffshore = isOffshorePacific(originLat, originLon);
  if (!startOffshore) {
    return {
      showLandfallFlag: false,
      landfallPoint: null,
      pathPoints: pts,
      landfallLabel: null,
    };
  }

  for (let i = 0; i < pts.length - 1; i += 1) {
    const [aLat, aLon] = pts[i];
    const [bLat, bLon] = pts[i + 1];
    const aOff = i === 0 ? startOffshore : isOffshorePacific(aLat, aLon);
    const bReachedCoast = !isOffshorePacific(bLat, bLon);
    if (aOff && bReachedCoast) {
      const lf = interpolateShoreCrossing(aLat, aLon, bLat, bLon);
      const outPath = [...pts.slice(0, i + 1), lf];
      return {
        showLandfallFlag: true,
        landfallPoint: lf,
        pathPoints: outPath,
        landfallLabel: `Shore approach ~${lf[0].toFixed(2)}°N (model)`,
      };
    }
  }

  return {
    showLandfallFlag: false,
    landfallPoint: null,
    pathPoints: pts,
    landfallLabel: null,
  };
}
