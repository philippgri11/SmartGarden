import { describe, expect, it } from 'vitest';

import { Zone, ZoneIrrigationProfile, ZoneProfileSuggestionResponse } from './api.models';
import {
  DEFAULT_ZONE_PROFILE,
  baseWaterLabel,
  buildZoneProfileSummary,
  cloneZoneProfile,
  containerFactorLabel,
  diffLabel,
  formatMm,
  rainEffectivenessLabel,
  sensitivityLabel,
  summarizeSuggestion,
  zoneProfileFromArea,
} from './zone-profile.utils';

const customProfile: ZoneIrrigationProfile = {
  ...DEFAULT_ZONE_PROFILE,
  zoneType: 'container',
  plantType: 'herbs',
  sunExposure: 'full_sun',
  rainExposure: 'low',
  rainEffectiveness: 0.2,
  waterNeedLevel: 'high',
  baseWaterNeedMmPerDay: 4.4,
  temperatureSensitivity: 1.4,
  sunSensitivity: 1.6,
  containerFactor: 1.8,
  dryingSpeed: 'fast',
  preferredTimeWindow: 'evening',
  explanation: 'Kräuter im sonnigen Kübel.',
};

describe('zone profile utils', () => {
  it('clones the default profile when no profile is available', () => {
    const clone = cloneZoneProfile(null);

    expect(clone).toEqual(DEFAULT_ZONE_PROFILE);
    expect(clone).not.toBe(DEFAULT_ZONE_PROFILE);

    clone.explanation = 'Geändert';
    expect(DEFAULT_ZONE_PROFILE.explanation).toBe('Standardprofil für ein ausgeglichenes Beet.');
  });

  it('returns human labels for numeric profile factors at their thresholds', () => {
    expect(rainEffectivenessLabel(0.01)).toBe('gar nicht');
    expect(rainEffectivenessLabel(0.25)).toBe('wenig');
    expect(rainEffectivenessLabel(0.55)).toBe('teilweise');
    expect(rainEffectivenessLabel(0.85)).toBe('stark');
    expect(rainEffectivenessLabel(0.9)).toBe('vollständig');

    expect(sensitivityLabel(0.7)).toBe('gering');
    expect(sensitivityLabel(1.0)).toBe('normal');
    expect(sensitivityLabel(1.3)).toBe('stark');
    expect(sensitivityLabel(1.7)).toBe('sehr stark');

    expect(containerFactorLabel(1.0)).toBe('kein Zusatz');
    expect(containerFactorLabel(1.25)).toBe('leicht erhöht');
    expect(containerFactorLabel(1.5)).toBe('deutlich erhöht');
    expect(containerFactorLabel(2.0)).toBe('hoch');
    expect(containerFactorLabel(2.3)).toBe('sehr hoch');

    expect(baseWaterLabel(2.0)).toBe('niedrig');
    expect(baseWaterLabel(3.0)).toBe('mittel');
    expect(baseWaterLabel(4.5)).toBe('hoch');
    expect(baseWaterLabel(6.0)).toBe('sehr hoch');
  });

  it('formats summaries and suggestion text for display', () => {
    expect(formatMm(3.25)).toBe('3,3 mm/Tag');
    expect(buildZoneProfileSummary(null)).toEqual([]);
    expect(buildZoneProfileSummary(customProfile)).toEqual([
      'Kübel · Kräuter',
      'Volle Sonne · trocknet schnell aus',
      'Wasserbedarf hoch · Regen zählt wenig',
    ]);

    expect(diffLabel({
      field: 'waterNeedLevel',
      label: 'Wasserbedarf',
      before_display: 'Mittel',
      after_display: 'Hoch',
    })).toBe('Wasserbedarf: Mittel → Hoch');

    const suggestion = {
      summary: ['Sonniger Standort', 'Mehr Wasser einplanen'],
    } as ZoneProfileSuggestionResponse;
    expect(summarizeSuggestion(suggestion)).toBe('Sonniger Standort · Mehr Wasser einplanen');
  });

  it('reads the irrigation profile from an area without sharing references', () => {
    const area = {
      irrigation_profile: customProfile,
    } as Zone;

    const profile = zoneProfileFromArea(area);

    expect(profile).toEqual(customProfile);
    expect(profile).not.toBe(customProfile);
  });
});
