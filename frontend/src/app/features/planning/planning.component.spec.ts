import { describe, expect, it } from 'vitest';

import { IrrigationProjectionItem } from '../../core/api.models';
import { PlanningComponent } from './planning.component';

function component(): PlanningComponent {
  return Object.create(PlanningComponent.prototype) as PlanningComponent;
}

const adaptiveItem: IrrigationProjectionItem = {
  zone_id: 1,
  zone_name: 'Hochbeet',
  schedule_id: 7,
  source: 'adaptive_rule',
  status: 'planned',
  planned_start: '2026-05-20T06:00:00+02:00',
  planned_end: '2026-05-20T06:12:00+02:00',
  original_start: '2026-05-20T06:00:00+02:00',
  duration_minutes: 12,
  reason: 'adaptive',
  weather_summary: 'trocken',
  decision_summary: 'Netto-Bedarf hoch',
  decision_details: ['Regen zählt kaum'],
  weather_basis: {
    source_status: 'fresh',
    preferred_time_windows: ['early_morning', 'evening'],
    temperature_max_24h_c: 25.25,
    allow_second_daily_run: true,
  },
  adjusted_for_sequence: false,
};

describe('PlanningComponent display helpers', () => {
  it('counts projected run states and sequence adjustments', () => {
    const instance = component();
    const items = [
      adaptiveItem,
      { ...adaptiveItem, status: 'skipped', adjusted_for_sequence: true },
      { ...adaptiveItem, source: 'manual_rule', status: 'blocked' },
    ] satisfies IrrigationProjectionItem[];

    expect(instance.countStatus(items, 'planned')).toBe(1);
    expect(instance.countStatus(items, 'skipped')).toBe(1);
    expect(instance.adjustedCount(items)).toBe(1);
    expect(instance.adaptiveItems(items)).toHaveLength(2);
  });

  it('builds user-facing labels for sources, statuses and weather source quality', () => {
    const instance = component();

    expect(instance.sourceText('fresh')).toBe('Wetterdaten wurden geladen');
    expect(instance.sourceText('stale')).toBe('Wetterdaten sind älter');
    expect(instance.sourceText('unavailable')).toBe('Wetterdaten nicht verfügbar');
    expect(instance.sourceLabel('manual_rule')).toBe('Manuell');
    expect(instance.sourceLabel('adaptive_rule')).toBe('KI-adaptiv');
    expect(instance.statusLabel('planned')).toBe('Geplant');
    expect(instance.statusLabel('skipped')).toBe('Ausgesetzt');
    expect(instance.statusLabel('blocked')).toBe('Blockiert');
  });

  it('explains manual, adaptive and skipped runs in plain German', () => {
    const instance = component();

    expect(instance.userReason({ ...adaptiveItem, source: 'manual_rule', adjusted_for_sequence: false }))
      .toBe('Manuell angelegte Regel.');
    expect(instance.userReason({ ...adaptiveItem, source: 'manual_rule', adjusted_for_sequence: true }))
      .toBe('Manuelle Regel, nach vorherigem Lauf einsortiert.');
    expect(instance.userReason(adaptiveItem)).toBe('KI-Regel plant 12 Minuten im passenden Zeitfenster.');
    expect(instance.userReason({ ...adaptiveItem, status: 'skipped', decision_summary: 'Heute genug Regen' }))
      .toBe('Heute genug Regen');
  });

  it('formats dates, numbers and weather basis values', () => {
    const instance = component();

    expect(instance.dayLabel(adaptiveItem.planned_start)).toContain('20.05.');
    expect(instance.timeLabel(adaptiveItem.planned_start)).toBe('06:00');
    expect(instance.formatDateTime(adaptiveItem.planned_start)).toContain('20.05.');
    expect(instance.numberValue(adaptiveItem.weather_basis!, 'temperature_max_24h_c', '°C')).toBe('25,3 °C');
    expect(instance.numberValue(adaptiveItem.weather_basis!, 'missing', 'mm')).toBe('unbekannt');
    expect(instance.numberValue({ factor: 1.25 }, 'factor', '×')).toBe('1,3×');
    expect(instance.boolValue(adaptiveItem.weather_basis!, 'allow_second_daily_run')).toBe(true);
    expect(instance.windowLabels(adaptiveItem.weather_basis!)).toBe('Früher Morgen, Abend');
    expect(instance.windowLabels({})).toBe('unbekannt');
    expect(instance.basisSourceLabel(adaptiveItem.weather_basis!)).toBe('aktuell');
    expect(instance.basisSourceLabel({ source_status: 'stale' })).toBe('älterer Cache');
    expect(instance.basisSourceLabel({ source_status: 'unavailable' })).toBe('nicht verfügbar');
  });
});
