/**
 * Supply restock flows: orders are placed with external suppliers;
 * inventory increments only when expected_arrival_at is reached.
 *
 * REACT_APP_SUPPLY_LEAD_SCALE — multiply simulated lead times (e.g. 0.02 for faster demos).
 */

const LEAD_SCALE = (() => {
  const v = parseFloat(process.env.REACT_APP_SUPPLY_LEAD_SCALE || '1', 10);
  return Number.isFinite(v) && v > 0 ? v : 1;
})();

const SUPPLIER_POOL = [
  'Pacific Maritime Supply Co.',
  'Coastal Logistics Partners',
  'NOAA-certified Equipment Exchange',
  'Harbor Industrial Fabricators',
  'Interstate Hazmat & Spill Response Supply',
];

function pickSupplier() {
  return SUPPLIER_POOL[Math.floor(Math.random() * SUPPLIER_POOL.length)];
}

/** How much to order so stock clears the low line with operational headroom. */
export function computeReorderQuantity(supply) {
  const q = Number(supply.quantity) || 0;
  const low = Number(supply.low_threshold) || 1;
  const target = Math.max(low * 2, low + Math.ceil(low * 0.75));
  const need = Math.max(0, target - q);
  const name = (supply.name || '').toLowerCase();
  let minBatch = 4;
  if (/bag/.test(name)) minBatch = 25;
  else if (/fuel|drum/.test(name)) minBatch = 4;
  else if (/ppe|kit/.test(name)) minBatch = 5;
  else if (/net/.test(name)) minBatch = 2;
  else if (/hazmat|suit/.test(name)) minBatch = 2;
  else if (/boom|skimmer|oil/.test(name)) minBatch = 1;
  return Math.max(need, minBatch);
}

function itemCategory(supplyName) {
  const n = (supplyName || '').toLowerCase();
  if (/fuel|drum/.test(n)) return 'fuel';
  if (/ppe|kit|bag/.test(n)) return 'consumable';
  if (/net|rope/.test(n)) return 'gear';
  if (/hazmat|suit|oil|boom|skimmer/.test(n)) return 'hazmat';
  return 'default';
}

/**
 * Hours from order to dock (supplier lead + fabrication + one consolidated ship leg).
 * Ranges [min, max] per stock profile; profile simulates warehouse availability.
 */
const LEAD_MATRIX = {
  fuel: {
    in_stock: [18, 52],
    low_stock: [72, 168],
    made_to_order: [240, 480],
  },
  consumable: {
    in_stock: [24, 72],
    low_stock: [96, 216],
    made_to_order: [180, 420],
  },
  gear: {
    in_stock: [48, 120],
    low_stock: [168, 360],
    made_to_order: [480, 960],
  },
  hazmat: {
    in_stock: [72, 168],
    low_stock: [336, 720],
    made_to_order: [720, 1680],
  },
  default: {
    in_stock: [36, 96],
    low_stock: [120, 288],
    made_to_order: [360, 840],
  },
};

/** Roll supplier availability: in_stock most common, made_to_order rarest. */
export function rollStockProfile() {
  const r = Math.random();
  if (r < 0.52) return 'in_stock';
  if (r < 0.82) return 'low_stock';
  return 'made_to_order';
}

function randomInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function leadHoursForOrder(supplyName, stockProfile) {
  const cat = itemCategory(supplyName);
  const row = LEAD_MATRIX[cat] || LEAD_MATRIX.default;
  const [lo, hi] = row[stockProfile] || row.in_stock;
  const h = randomInt(lo, hi);
  return Math.max(1, Math.round(h * LEAD_SCALE));
}

export function fulfillmentNote(stockProfile, supplyName, hours) {
  const days = (hours / 24).toFixed(1);
  if (stockProfile === 'in_stock') {
    return `Supplier had ${supplyName} in regional stock — pick, QA pack, and consolidated freight (~${days} d).`;
  }
  if (stockProfile === 'low_stock') {
    return `Limited shelf stock; supplier cross-docked from secondary warehouse + inbound manufacturing batch (~${days} d).`;
  }
  return `Made-to-order / certified build slot for ${supplyName}; supplier queued fabrication then sea freight (~${days} d).`;
}

export function expectedArrivalIsoFromHours(hours) {
  const ms = Date.now() + hours * 3600000;
  return new Date(ms).toISOString();
}

/** Plan one order row (client inserts into supply_orders). */
export function planSupplyOrder(supply) {
  const quantity = computeReorderQuantity(supply);
  const stock_profile = rollStockProfile();
  const leadHours = leadHoursForOrder(supply.name, stock_profile);
  const expected_arrival_at = expectedArrivalIsoFromHours(leadHours);
  const supplier_name = pickSupplier();
  const fulfillment_note = fulfillmentNote(stock_profile, supply.name, leadHours);
  return {
    supply_id: supply.id,
    quantity,
    expected_arrival_at,
    status: 'in_transit',
    supplier_name,
    fulfillment_note,
    stock_profile,
    /** Wall-clock hours (after REACT_APP_SUPPLY_LEAD_SCALE) — for UI only */
    lead_hours_planned: leadHours,
  };
}

export function formatEtaHuman(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diff = t - Date.now();
  if (diff <= 0) return 'due now';
  const h = diff / 3600000;
  if (h < 48) return `~${Math.max(1, Math.round(h))} h`;
  const d = h / 24;
  if (d < 14) return `~${d.toFixed(1)} days`;
  return `~${Math.round(d)} days`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Live countdown until ISO arrival; pure (recompute each render / tick). */
export function formatCountdownTo(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const diff = t - Date.now();
  if (diff <= 0) return 'Due — refreshing';
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (days > 0) return `${days}d ${h}h ${m}m ${s}s`;
  return `${h}:${pad2(m)}:${pad2(s)}`;
}

/** Apply any orders whose ETA has passed — run before loading supplies. */
export async function applyDeliveredSupplyOrders(supabase) {
  const now = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('supply_orders')
    .select('*')
    .eq('status', 'in_transit')
    .lte('expected_arrival_at', now);

  if (error) {
    console.warn('supply_orders fetch (delivery sweep):', error.message);
    return { delivered: 0, error };
  }
  if (!due?.length) return { delivered: 0 };

  let delivered = 0;
  for (const o of due) {
    const { data: row, error: gErr } = await supabase
      .from('supplies')
      .select('quantity')
      .eq('id', o.supply_id)
      .single();
    if (gErr || row == null) {
      await supabase.from('supply_orders').update({ status: 'cancelled' }).eq('id', o.id);
      continue;
    }
    const nextQty = (Number(row.quantity) || 0) + (Number(o.quantity) || 0);
    const { error: uErr } = await supabase
      .from('supplies')
      .update({ quantity: nextQty, updated_at: now })
      .eq('id', o.supply_id);
    if (uErr) {
      console.warn('supply delivery update failed', uErr);
      continue;
    }
    await supabase.from('supply_orders').update({ status: 'delivered' }).eq('id', o.id);
    delivered += 1;
  }
  return { delivered };
}

export async function insertSupplyOrder(supabase, supply) {
  const plan = planSupplyOrder(supply);
  const { data, error } = await supabase
    .from('supply_orders')
    .insert({
      supply_id: plan.supply_id,
      zone: supply.zone || null,
      quantity: plan.quantity,
      expected_arrival_at: plan.expected_arrival_at,
      status: plan.status,
      supplier_name: plan.supplier_name,
      fulfillment_note: plan.fulfillment_note,
      stock_profile: plan.stock_profile,
    })
    .select()
    .single();
  return { data, error, plan };
}
