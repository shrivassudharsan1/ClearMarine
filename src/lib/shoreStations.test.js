import {
  nearestShorePoint,
  syntheticShoreId,
  isSyntheticShoreId,
  synthesizeShoreStationForSighting,
} from './shoreStations';

describe('nearestShorePoint', () => {
  test('point off SoCal snaps to NE Pacific knots near 32–33° latitude', () => {
    const pt = nearestShorePoint(32.5, -120);
    expect(pt).not.toBe(null);
    expect(pt[0]).toBeGreaterThanOrEqual(31);
    expect(pt[0]).toBeLessThanOrEqual(34);
    // SoCal coast longitudes hover around -117 to -120
    expect(pt[1]).toBeGreaterThanOrEqual(-121);
    expect(pt[1]).toBeLessThanOrEqual(-115);
  });

  test('Atlantic point near Bermuda snaps to a coastline', () => {
    const pt = nearestShorePoint(32, -64.7);
    expect(pt).not.toBe(null);
    // Should be west of the sighting (toward US east coast / Gulf coast)
    expect(pt[1]).toBeLessThan(-64.7);
  });

  test('returns null for non-finite inputs', () => {
    expect(nearestShorePoint(NaN, -120)).toBe(null);
    expect(nearestShorePoint(34, undefined)).toBe(null);
  });
});

describe('synthetic shore id', () => {
  test('round-trip: id is recognized as synthetic', () => {
    const id = syntheticShoreId(32.123, -117.456);
    expect(isSyntheticShoreId(id)).toBe(true);
  });

  test('a real UUID is not flagged as synthetic', () => {
    expect(isSyntheticShoreId('00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(isSyntheticShoreId(null)).toBe(false);
  });
});

describe('synthesizeShoreStationForSighting', () => {
  test('uses landfall point when drift→shore is detected (NE Pacific)', () => {
    const sighting = { latitude: 35, lon: -123, longitude: -123 };
    const drift = {
      lat_24h: 35.1, lon_24h: -122,
      lat_48h: 35.2, lon_48h: -121.5,
      lat_72h: 35.3, lon_72h: -121.0,
    };
    const station = synthesizeShoreStationForSighting(sighting, drift);
    expect(station).not.toBe(null);
    expect(station.synthetic).toBe(true);
    expect(station.status).toBe('available');
    // Station should sit on the NE Pacific shoreline (lon around -120 to -121).
    expect(station.base_lon).toBeLessThan(-119);
  });

  test('falls back to nearest shore when no drift is provided', () => {
    const sighting = { latitude: 32, longitude: -64.7 };
    const station = synthesizeShoreStationForSighting(sighting, null);
    expect(station).not.toBe(null);
    expect(station.synthetic).toBe(true);
    expect(station.id).toMatch(/^synthetic-shore:/);
  });

  test('returns null for invalid coordinates', () => {
    expect(synthesizeShoreStationForSighting(null, null)).toBe(null);
    expect(synthesizeShoreStationForSighting({ latitude: NaN, longitude: 0 }, null)).toBe(null);
  });
});
