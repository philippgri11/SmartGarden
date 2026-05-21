import { describe, expect, it } from 'vitest';

import { easterSunday, isAdaptiveCapacitySkip, isGermanFathersDay } from './dashboard.component';


describe('dashboard fathers day banner date logic', () => {
  it('calculates Easter Sunday for known years', () => {
    const easter2026 = easterSunday(2026);
    const easter2027 = easterSunday(2027);

    expect([easter2026.getFullYear(), easter2026.getMonth(), easter2026.getDate()]).toEqual([2026, 3, 5]);
    expect([easter2027.getFullYear(), easter2027.getMonth(), easter2027.getDate()]).toEqual([2027, 2, 28]);
  });

  it('shows the banner only on German Fathers Day', () => {
    expect(isGermanFathersDay(new Date(2026, 4, 14))).toBe(true);
    expect(isGermanFathersDay(new Date(2026, 4, 15))).toBe(false);
    expect(isGermanFathersDay(new Date(2027, 4, 6))).toBe(true);
  });

  it('detects adaptive skips caused by full time windows', () => {
    expect(isAdaptiveCapacitySkip({
      source: 'adaptive_rule',
      status: 'skipped',
      reason: 'Das freigegebene Zeitfenster reicht nach vorherigen Laeufen nicht mehr aus.',
      decision_summary: null,
    })).toBe(true);

    expect(isAdaptiveCapacitySkip({
      source: 'adaptive_rule',
      status: 'skipped',
      reason: 'Regen wird erwartet.',
      decision_summary: 'Ausgesetzt wegen Regen.',
    })).toBe(false);
  });
});
