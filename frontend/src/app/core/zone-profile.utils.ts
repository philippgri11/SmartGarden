import { Zone, ZoneIrrigationProfile, ZoneProfileDiffItem, ZoneProfileSuggestionResponse } from './api.models';

export const ZONE_TYPE_LABELS: Record<ZoneIrrigationProfile['zoneType'], string> = {
  lawn: 'Rasen',
  bed: 'Beet',
  raised_bed: 'Hochbeet',
  container: 'Kübel',
  greenhouse: 'Gewächshaus',
  hedge: 'Hecke',
  other: 'Sonstiges',
};

export const PLANT_TYPE_LABELS: Record<ZoneIrrigationProfile['plantType'], string> = {
  grass: 'Gräser',
  vegetables: 'Gemüse',
  flowers: 'Blumen',
  herbs: 'Kräuter',
  shrubs: 'Sträucher',
  trees: 'Bäume',
  mixed: 'Gemischt',
  unknown: 'Unbekannt',
};

export const SUN_EXPOSURE_LABELS: Record<ZoneIrrigationProfile['sunExposure'], string> = {
  shade: 'Schatten',
  partial_shade: 'Halbschatten',
  sunny: 'Sonnig',
  full_sun: 'Volle Sonne',
};

export const RAIN_EXPOSURE_LABELS: Record<ZoneIrrigationProfile['rainExposure'], string> = {
  none: 'Kein Regen',
  low: 'Wenig Regen',
  medium: 'Teilweise Regen',
  high: 'Viel Regen',
  full: 'Voller Regen',
};

export const WATER_NEED_LABELS: Record<ZoneIrrigationProfile['waterNeedLevel'], string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  very_high: 'Sehr hoch',
};

export const DRYING_SPEED_LABELS: Record<ZoneIrrigationProfile['dryingSpeed'], string> = {
  slow: 'Langsam',
  normal: 'Normal',
  fast: 'Schnell',
  very_fast: 'Sehr schnell',
};

export const FREQUENCY_LABELS: Record<ZoneIrrigationProfile['wateringFrequencyPreference'], string> = {
  rare_deep: 'Selten, dafür gründlich',
  normal: 'Ausgewogen',
  frequent_short: 'Häufig und kurz',
};

export const TIME_WINDOW_LABELS: Record<ZoneIrrigationProfile['preferredTimeWindow'], string> = {
  early_morning: 'Früher Morgen',
  morning: 'Morgen',
  evening: 'Abend',
  morning_and_evening: 'Morgens und abends',
};

export const STRATEGY_LABELS: Record<ZoneIrrigationProfile['strategy'], string> = {
  water_saving: 'Wassersparend',
  balanced: 'Ausgewogen',
  growth_oriented: 'Wachstumsorientiert',
};

export const RISK_PROFILE_LABELS: Record<ZoneIrrigationProfile['riskProfile'], string> = {
  avoid_overwatering: 'Überwässerung vermeiden',
  balanced: 'Ausgewogen',
  avoid_drought_stress: 'Trockenstress vermeiden',
};

export const DEFAULT_ZONE_PROFILE: ZoneIrrigationProfile = {
  zoneType: 'bed',
  plantType: 'mixed',
  sunExposure: 'partial_shade',
  rainExposure: 'medium',
  rainEffectiveness: 0.7,
  waterNeedLevel: 'medium',
  baseWaterNeedMmPerDay: 3,
  temperatureSensitivity: 1,
  sunSensitivity: 1,
  containerFactor: 1,
  dryingSpeed: 'normal',
  wateringFrequencyPreference: 'normal',
  preferredTimeWindow: 'morning',
  strategy: 'balanced',
  riskProfile: 'balanced',
  explanation: 'Standardprofil für ein ausgeglichenes Beet.',
};

export function cloneZoneProfile(profile?: ZoneIrrigationProfile | null): ZoneIrrigationProfile {
  return JSON.parse(JSON.stringify(profile ?? DEFAULT_ZONE_PROFILE));
}

export function rainEffectivenessLabel(value: number): string {
  if (value <= 0.05) return 'gar nicht';
  if (value <= 0.25) return 'wenig';
  if (value <= 0.55) return 'teilweise';
  if (value <= 0.85) return 'stark';
  return 'vollständig';
}

export function sensitivityLabel(value: number): string {
  if (value < 0.85) return 'gering';
  if (value < 1.2) return 'normal';
  if (value < 1.55) return 'stark';
  return 'sehr stark';
}

export function containerFactorLabel(value: number): string {
  if (value <= 1.05) return 'kein Zusatz';
  if (value <= 1.35) return 'leicht erhöht';
  if (value <= 1.7) return 'deutlich erhöht';
  if (value <= 2.1) return 'hoch';
  return 'sehr hoch';
}

export function baseWaterLabel(value: number): string {
  if (value < 2.5) return 'niedrig';
  if (value < 4) return 'mittel';
  if (value < 5.5) return 'hoch';
  return 'sehr hoch';
}

export function formatMm(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} mm/Tag`;
}

export function buildZoneProfileSummary(profile?: ZoneIrrigationProfile | null): string[] {
  if (!profile) {
    return [];
  }
  return [
    `${ZONE_TYPE_LABELS[profile.zoneType]} · ${PLANT_TYPE_LABELS[profile.plantType]}`,
    `${SUN_EXPOSURE_LABELS[profile.sunExposure]} · trocknet ${DRYING_SPEED_LABELS[profile.dryingSpeed].toLowerCase()} aus`,
    `Wasserbedarf ${WATER_NEED_LABELS[profile.waterNeedLevel].toLowerCase()} · Regen zählt ${rainEffectivenessLabel(profile.rainEffectiveness)}`,
  ];
}

export function diffLabel(item: ZoneProfileDiffItem): string {
  return `${item.label}: ${item.before_display} → ${item.after_display}`;
}

export function summarizeSuggestion(response: ZoneProfileSuggestionResponse): string {
  return response.summary.join(' · ');
}

export function zoneProfileFromArea(area: Zone): ZoneIrrigationProfile {
  return cloneZoneProfile(area.irrigation_profile);
}
