/**
 * Fetches real ocean current data from NOAA HYCOM and populates
 * the ocean_currents table in Supabase.
 *
 * Run once (or periodically) from Node — no CORS restrictions here.
 *   node scripts/seed_currents.js
 *
 * HYCOM GLBy0.08 expt_93.0 — 1/12° operational ocean model
 * u/v values in the CSV are in mm/s (divide by 1000 → m/s)
 * Gulf Stream test: 1355 mm/s = 1.355 m/s = 2.63 knots ✓
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

// Grid covering Pacific debris zones + Atlantic for completeness
// 5° resolution — 121 ocean grid points
const GRID_LATS = [10, 15, 20, 25, 30, 35, 40, 45, 50];
const GRID_LONS = [-180, -175, -170, -165, -160, -155, -150, -145, -140,
                   -135, -130, -125, -120];  // Pacific focus

const HYCOM_DATE = '2024-09-05T00:00:00Z'; // Last known good date in expt_93.0

async function fetchCurrent(lat, lon) {
  const url = `https://ncss.hycom.org/thredds/ncss/GLBy0.08/expt_93.0/uv3z` +
    `?var=water_u&var=water_v` +
    `&latitude=${lat}&longitude=${lon}` +
    `&time_start=${HYCOM_DATE}&time_end=${HYCOM_DATE}` +
    `&vertCoord=0&accept=csv`;

  const res = await fetch(url);
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('No data rows');

  const values = lines[1].split(',');
  const u_raw = parseFloat(values[4]);
  const v_raw = parseFloat(values[5]);

  // Fill value is ±30000 (land/no data)
  if (Math.abs(u_raw) > 29000 || Math.abs(v_raw) > 29000) return null;

  // HYCOM CSV values are in mm/s — convert to m/s
  const u_ms = u_raw / 1000;
  const v_ms = v_raw / 1000;
  const speed_ms = Math.sqrt(u_ms ** 2 + v_ms ** 2);
  const speed_knots = speed_ms * 1.944;
  const bearing = ((Math.atan2(u_ms, v_ms) * 180) / Math.PI + 360) % 360;

  return { lat, lon, u_ms, v_ms, speed_knots, bearing };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`Seeding ocean currents from NOAA HYCOM (${HYCOM_DATE})...`);
  console.log(`Grid: ${GRID_LATS.length} lats × ${GRID_LONS.length} lons = ${GRID_LATS.length * GRID_LONS.length} points\n`);

  // Clear existing current data
  await supabase.from('ocean_currents').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const records = [];
  let fetched = 0;
  let skipped = 0;

  for (const lat of GRID_LATS) {
    for (const lon of GRID_LONS) {
      try {
        const current = await fetchCurrent(lat, lon);
        if (current) {
          records.push({
            lat: current.lat,
            lon: current.lon,
            u_ms: current.u_ms,
            v_ms: current.v_ms,
            speed_knots: current.speed_knots,
            bearing: current.bearing,
            source: 'NOAA HYCOM GLBy0.08 expt_93.0',
            recorded_at: HYCOM_DATE,
          });
          console.log(`✓ (${lat}, ${lon}) → ${current.speed_knots.toFixed(2)} kn @ ${current.bearing.toFixed(0)}°`);
          fetched++;
        } else {
          console.log(`  (${lat}, ${lon}) — land/no data`);
          skipped++;
        }
      } catch (e) {
        console.log(`  (${lat}, ${lon}) — error: ${e.message}`);
        skipped++;
      }
      await sleep(200); // be polite to HYCOM
    }
  }

  if (records.length > 0) {
    const { error } = await supabase.from('ocean_currents').insert(records);
    if (error) {
      console.error('\nSupabase insert error:', error.message);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${fetched} ocean points seeded, ${skipped} land/skipped.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
