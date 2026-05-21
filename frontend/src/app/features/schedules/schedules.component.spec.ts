import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { Schedule, Zone } from '../../core/api.models';
import { SchedulesComponent } from './schedules.component';

function component(): SchedulesComponent {
  const instance = Object.create(SchedulesComponent.prototype) as SchedulesComponent & {
    scenarioByZone: ReturnType<typeof signal<Record<number, unknown>>>;
  };
  instance.scenarioByZone = signal({});
  return instance;
}

const fixedSchedule: Schedule = {
  id: 1,
  zone_id: 7,
  active: true,
  weekdays: ['mon', 'wed'],
  start_time: '06:15:00',
  duration_minutes: 12,
  interval_hours: null,
  window_start: null,
  window_end: null,
  weather_enabled: true,
  weather_probability_threshold: 70,
  weather_precipitation_mm_threshold: 2,
};

const intervalSchedule: Schedule = {
  ...fixedSchedule,
  id: 2,
  interval_hours: 4,
  window_start: '06:00:00',
  window_end: '18:00:00',
  weather_enabled: false,
};

const adaptiveZone = {
  id: 7,
  name: 'Hochbeet',
  max_duration_minutes: 30,
  irrigation_profile: {
    zoneType: 'raised_bed',
    plantType: 'vegetables',
    sunExposure: 'full_sun',
    rainExposure: 'low',
    rainEffectiveness: 0.4,
    waterNeedLevel: 'high',
    baseWaterNeedMmPerDay: 4,
    temperatureSensitivity: 1.2,
    sunSensitivity: 1.1,
    containerFactor: 1.4,
    dryingSpeed: 'fast',
    wateringFrequencyPreference: 'normal',
    preferredTimeWindow: 'morning_and_evening',
    strategy: 'balanced',
    riskProfile: 'balanced',
    explanation: 'Sonniges Hochbeet.',
  },
  adaptive_irrigation_plan: {
    irrigationMethod: 'drip',
    preferredTimeWindows: ['morning_and_evening'],
    avoidMidday: true,
    allowSecondDailyRun: false,
    minIntervalHours: 8,
    baseDurationMinutes: 12,
    minDurationMinutes: 5,
    maxDurationMinutes: 20,
    rainSkipThresholdMm: 4,
    rainDelayThresholdMm: 3,
    heatThresholdC: 28,
    highNeedThresholdMm: 5,
    rules: [],
    explanation: 'Adaptiv.',
  },
} as Zone;

describe('SchedulesComponent display helpers', () => {
  it('formats schedule text, weekdays, duration and weather copy', () => {
    const instance = component();

    expect(instance.scheduleText(fixedSchedule)).toBe('mon, wed · 06:15:00 · 12 min');
    expect(instance.scheduleText(intervalSchedule)).toBe('mon, wed · 06:00:00–18:00:00 · alle 4h · 12 min');
    expect(instance.weekdayLabel('mon')).toBe('Mo');
    expect(instance.weekdayLabel('holiday')).toBe('holiday');
    expect(instance.weekdayLongLabel('thu')).toBe('Donnerstag');
    expect(instance.weekdayText(['mon'])).toBe('Montag');
    expect(instance.weekdayText(['mon', 'wed'])).toBe('Montag und Mittwoch');
    expect(instance.weekdayText(['mon', 'wed', 'sun'])).toBe('Montag, Mittwoch und Sonntag');
    expect(instance.scheduleTypeLabel(fixedSchedule)).toBe('Feste Uhrzeit');
    expect(instance.scheduleTypeLabel(intervalSchedule)).toBe('Wiederholung');
    expect(instance.formatTime(null)).toBe('Nicht festgelegt');
    expect(instance.formatTime('06:15:00')).toBe('06:15');
    expect(instance.durationLabel(1)).toBe('1 Minute');
    expect(instance.durationLabel(12)).toBe('12 Minuten');
  });

  it('builds readable schedule summaries', () => {
    const instance = component();

    expect(instance.primaryTimeLabel(intervalSchedule)).toBe('06:00 bis 18:00 Uhr');
    expect(instance.primaryTimeLabel(fixedSchedule)).toBe('06:15 Uhr');
    expect(instance.cadenceLabel(intervalSchedule)).toBe('alle 4 Std., je 12 Minuten');
    expect(instance.cadenceLabel(fixedSchedule)).toBe('12 Minuten');
    expect(instance.weatherLabel(fixedSchedule)).toBe('Wird berücksichtigt');
    expect(instance.weatherLabel(intervalSchedule)).toBe('Nicht aktiv');
    expect(instance.weatherNote(intervalSchedule)).toBe('Dieser Plan läuft unabhängig von der Wettersteuerung.');
    expect(instance.weatherNote(fixedSchedule)).toContain('Regenwahrscheinlichkeit ab 70 %');
    expect(instance.scheduleSummary(fixedSchedule)).toBe('Montag und Mittwoch um 06:15 Uhr für 12 Minuten.');
    expect(instance.scheduleSummary(intervalSchedule)).toBe('Montag und Mittwoch zwischen 06:00 und 18:00 Uhr, alle 4 Stunden.');
  });

  it('summarizes adaptive plans for users and experts', () => {
    const instance = component();

    expect(instance.adaptiveWindowText(adaptiveZone)).toBe('Morgens und abends');
    expect(instance.adaptiveDurationText(adaptiveZone)).toBe('5-20 Min., Basis 12 Min.');
    expect(instance.adaptiveSummary(adaptiveZone)).toBe('Wetterbasierter Regelplan: Morgens und abends, maximal ein automatischer Lauf pro Tag.');
    expect(instance.adaptiveWeatherNote(adaptiveZone)).toContain('Regen-Skip ab 4 mm');
    expect(instance.technicalRule(adaptiveZone)).toContain('Basisdauer = 12 min');

    const incompleteZone = { ...adaptiveZone, adaptive_irrigation_plan: null };
    expect(instance.adaptiveWindowText(incompleteZone)).toBe('Noch nicht festgelegt');
    expect(instance.adaptiveDurationText(incompleteZone)).toBe('Noch nicht festgelegt');
    expect(instance.adaptiveSummary(incompleteZone)).toBe('Adaptive Regeln sind noch nicht vollständig gespeichert.');
    expect(instance.adaptiveWeatherNote(incompleteZone)).toBe('Dieser Bereich ist auf adaptiv gestellt, hat aber noch keinen Regelplan.');
    expect(instance.technicalRule(incompleteZone)).toBe('Kein vollständiger adaptiver Regelplan gespeichert.');
  });

  it('calculates adaptive scenario rows and clamps scenario inputs', () => {
    const instance = component();

    expect(instance.scenarioValue(7, 'days')).toBe(3);
    instance.updateScenario(7, 'days', '20');
    instance.updateScenario(7, 'alreadyWateredToday', 'true');
    expect(instance.scenarioValue(7, 'days')).toBe(14);
    expect(instance.scenarioValue(7, 'alreadyWateredToday')).toBe(true);

    const rows = instance.adaptiveScenarioRows(adaptiveZone);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      dayLabel: 'Tag 1',
      windowLabel: 'Früher Morgen',
      timeLabel: '05:30',
    });
    expect(rows.some((row) => row.decision === 'Kein Lauf')).toBe(true);

    const privateInstance = instance as unknown as {
      adaptiveWindowStart: (window: string) => string;
      adaptiveWindowHour: (window: string) => number;
      formatNumber: (value: number) => string;
      clamp: (value: number, min: number, max: number) => number;
    };
    expect(privateInstance.adaptiveWindowStart('unknown')).toBe('nach Regel');
    expect(privateInstance.adaptiveWindowHour('unknown')).toBe(12);
    expect(privateInstance.formatNumber(1.234)).toBe('1,23');
    expect(privateInstance.clamp(20, 0, 10)).toBe(10);
  });
});
