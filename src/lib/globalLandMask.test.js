import { isOnGlobalLand, firstLandContactFraction } from './globalLandMask';

describe('isOnGlobalLand', () => {
  test('open Atlantic near Bermuda is water', () => {
    expect(isOnGlobalLand(32, -64.7)).toBe(false);
  });

  test('mid Pacific is water', () => {
    expect(isOnGlobalLand(20, -150)).toBe(false);
    expect(isOnGlobalLand(0, -160)).toBe(false);
  });

  test('continental US (Tennessee) is land', () => {
    expect(isOnGlobalLand(35.5, -86)).toBe(true);
  });

  test('central Mexico is land', () => {
    expect(isOnGlobalLand(20, -100)).toBe(true);
  });

  test('central Europe is land', () => {
    expect(isOnGlobalLand(50, 10)).toBe(true);
  });

  test('central Africa is land', () => {
    expect(isOnGlobalLand(0, 20)).toBe(true);
  });

  test('central Australia is land', () => {
    expect(isOnGlobalLand(-25, 134)).toBe(true);
  });

  test('south of Antarctic mask is land/ice', () => {
    expect(isOnGlobalLand(-75, 0)).toBe(true);
  });

  test('non-finite coords are safe (water)', () => {
    expect(isOnGlobalLand(NaN, 0)).toBe(false);
    expect(isOnGlobalLand(0, undefined)).toBe(false);
  });
});

describe('firstLandContactFraction', () => {
  test('open ocean → open ocean returns null (no contact)', () => {
    expect(firstLandContactFraction(32, -64, 33, -62)).toBe(null);
  });

  test('Bermuda → Tennessee crosses US east coast and stops before half', () => {
    const t = firstLandContactFraction(32, -64.7, 35.5, -86);
    expect(t).not.toBe(null);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });

  test('starting on land returns 0', () => {
    expect(firstLandContactFraction(35.5, -86, 32, -64.7)).toBe(0);
  });
});
