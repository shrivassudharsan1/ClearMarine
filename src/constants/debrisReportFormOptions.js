/** Canonical values for debris report dropdowns (voice → form mapping must use these exact `value` strings). */

export const WASTE_TYPE_OPTIONS = [
  { value: 'plastic', label: 'Plastic / foam / bottles' },
  { value: 'fishing_gear', label: 'Fishing gear / nets / rope' },
  { value: 'organic', label: 'Organic / wood / vegetation' },
  { value: 'chemical', label: 'Oil / chemical / hazardous sheen' },
  { value: 'mixed', label: 'Mixed types' },
  { value: 'unknown', label: 'Not sure' },
];

export const SIZE_OPTIONS = [
  { value: 'Single item (hand-sized or smaller)', label: 'One small item (hand-sized or smaller)' },
  { value: 'Single large item (bucket to tire-sized)', label: 'One large item (bucket to tire-sized)' },
  { value: 'Pile — fills a shopping bag', label: 'Pile — about a shopping bag' },
  { value: 'Pile — wheelbarrow or larger', label: 'Pile — wheelbarrow-sized or larger' },
  { value: 'Linear debris — a few meters', label: 'Stretched along shore/water — a few meters' },
  { value: 'Linear debris — tens of meters or more', label: 'Line or slick — tens of meters or more' },
  { value: 'Widespread field / patch', label: 'Widespread patch or field of debris' },
];

export const QUANTITY_OPTIONS = [
  { value: '1', label: '1 piece' },
  { value: '2–10', label: '2–10 pieces' },
  { value: '10–100', label: '10–100 pieces' },
  { value: '100+', label: 'More than 100 pieces' },
  { value: 'Continuous line or slick', label: 'Continuous line or slick (no clear count)' },
];

export const SPREAD_OPTIONS = [
  { value: '', label: 'Not sure / skip' },
  { value: 'concentrated', label: 'Mostly one spot' },
  { value: 'scattered', label: 'Scattered pieces' },
  { value: 'linear_along_shore', label: 'Along a shoreline or track' },
  { value: 'widespread_patch', label: 'Spread over a wide area' },
];

export const WASTE_TYPE_VALUES = WASTE_TYPE_OPTIONS.map((o) => o.value);
export const SIZE_VALUES = SIZE_OPTIONS.map((o) => o.value);
export const QUANTITY_VALUES = QUANTITY_OPTIONS.map((o) => o.value);
/** Includes empty string for “not sure”. */
export const SPREAD_VALUES = SPREAD_OPTIONS.map((o) => o.value);
