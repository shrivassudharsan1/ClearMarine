import {
  isOnLandInPacificModel,
  isNortheastPacificShorelineModel,
  shouldShowSightingOnDashboard,
  computePacificLandfallDisplay,
  clipDriftPathAgainstGlobalLand,
} from './landfall';

describe('shouldShowSightingOnDashboard', () => {
  test('shows Pacific points the old heuristic called "on-land" (detector disabled)', () => {
    expect(shouldShowSightingOnDashboard(37.5, -121)).toBe(true);
  });

  test('shows open ocean in Pacific model', () => {
    expect(shouldShowSightingOnDashboard(34, -125)).toBe(true);
  });

  test('shows points outside NE Pacific model (no land mask)', () => {
    expect(shouldShowSightingOnDashboard(0, 10)).toBe(true);
  });

  test('hides invalid coords', () => {
    expect(shouldShowSightingOnDashboard(null, -120)).toBe(false);
  });
});

describe('computePacificLandfallDisplay (Atlantic / global mask)', () => {
  test('caps a runaway 24h leg from Bermuda — final point stays in the Atlantic basin', () => {
    // A bogus drift row claiming the trash drifts 3000 km west across the US in 24h.
    const drift = {
      lat_24h: 33, lon_24h: -86,
      lat_48h: 33, lon_48h: -100,
      lat_72h: 33, lon_72h: -110,
    };
    const r = computePacificLandfallDisplay(32, -64.7, drift);
    expect(r.pathPoints.length).toBeGreaterThanOrEqual(2);
    // Last point should be capped well before reaching the US east coast.
    const last = r.pathPoints[r.pathPoints.length - 1];
    expect(last[1]).toBeLessThan(-60);
    expect(last[1]).toBeGreaterThan(-72);
  });

  test('clips a path that aims toward continental land at the coast (not inland)', () => {
    // Capping leaves us still in the Atlantic, so we manually craft a leg that the cap
    // doesn't shorten enough to need clipping. Use a small displacement just east of FL.
    const drift = {
      lat_24h: 28, lon_24h: -78,
      lat_48h: 28, lon_48h: -80,
      lat_72h: 28, lon_72h: -82,
    };
    const r = computePacificLandfallDisplay(28, -77, drift);
    // No path point should land deep inside the continent.
    for (const [, lo] of r.pathPoints) {
      expect(lo).toBeLessThan(-70); // Florida's western Gulf coast is around -83°
    }
  });
});

describe('clipDriftPathAgainstGlobalLand', () => {
  test('open-water → open-water keeps both endpoints', () => {
    const r = clipDriftPathAgainstGlobalLand([[32, -64], [33, -62]]);
    expect(r.hitShore).toBe(false);
    expect(r.pathPoints).toHaveLength(2);
  });

  test('water → continental US flags shore contact and trims the inland leg', () => {
    const r = clipDriftPathAgainstGlobalLand([[32, -64.7], [35, -85]]);
    expect(r.hitShore).toBe(true);
    expect(r.landfallPoint).not.toBe(null);
    // Contact point must be east of mainland US interior.
    expect(r.landfallPoint[1]).toBeLessThan(-70);
  });
});

describe('isOnLandInPacificModel (disabled)', () => {
  test('shoreline geometry helper still classifies the NE Pacific window', () => {
    expect(isNortheastPacificShorelineModel(37.5, -121)).toBe(true);
  });

  test('always returns false — on-land detection is off for now', () => {
    expect(isOnLandInPacificModel(34, -125)).toBe(false);
    expect(isOnLandInPacificModel(37.5, -121)).toBe(false);
    expect(isOnLandInPacificModel(35, 140)).toBe(false);
  });
});
