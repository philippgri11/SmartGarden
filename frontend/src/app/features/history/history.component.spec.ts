import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { WateringRun, Zone } from '../../core/api.models';
import { HistoryComponent } from './history.component';

function component(): HistoryComponent {
  const instance = Object.create(HistoryComponent.prototype) as HistoryComponent & {
    filter: ReturnType<typeof signal<'all' | 'completed' | 'skipped' | 'failed' | 'manual' | 'scheduled'>>;
  };
  instance.filter = signal('all');
  return instance;
}

function run(overrides: Partial<WateringRun> = {}): WateringRun {
  return {
    id: 1,
    zone_id: 1,
    schedule_id: null,
    trigger_type: 'manual',
    status: 'completed',
    scheduled_for: '2026-05-20T06:00:00+02:00',
    requested_duration_minutes: 10,
    sequence_group_id: null,
    sequence_order: null,
    started_at: '2026-05-20T06:00:00+02:00',
    finished_at: '2026-05-20T06:10:00+02:00',
    duration_seconds: 600,
    stop_requested: false,
    reason: null,
    created_at: '2026-05-20T05:59:00+02:00',
    weather_decisions: [],
    ...overrides,
  };
}

const zones = [{ id: 1, name: 'Hochbeet' }] as Zone[];

describe('HistoryComponent display helpers', () => {
  it('filters runs by status and trigger type', () => {
    const instance = component();
    const runs = [
      run({ id: 1, status: 'completed', trigger_type: 'manual' }),
      run({ id: 2, status: 'failed', trigger_type: 'scheduled' }),
      run({ id: 3, status: 'skipped', trigger_type: 'scheduled' }),
    ];

    instance.filter.set('all');
    expect(instance.filteredRuns(runs)).toHaveLength(3);
    instance.filter.set('manual');
    expect(instance.filteredRuns(runs).map((item) => item.id)).toEqual([1]);
    instance.filter.set('scheduled');
    expect(instance.filteredRuns(runs).map((item) => item.id)).toEqual([2, 3]);
    instance.filter.set('skipped');
    expect(instance.filteredRuns(runs).map((item) => item.id)).toEqual([3]);
  });

  it('collapses duplicate stop events', () => {
    const instance = component();
    const first = run({
      id: 1,
      status: 'cancelled',
      stop_requested: true,
      reason: 'Not-Aus',
      finished_at: '2026-05-20T06:10:00+02:00',
    });

    const displayed = instance.displayedRuns([
      first,
      { ...first, id: 2 },
      { ...first, id: 3, finished_at: '2026-05-20T06:11:00+02:00' },
    ]);

    expect(displayed).toHaveLength(2);
    expect(displayed[0].repeatCount).toBe(2);
    expect(displayed[1].repeatCount).toBe(1);
  });

  it('turns run states into readable timeline sentences', () => {
    const instance = component();

    expect(instance.toSentence(run({ status: 'completed', requested_duration_minutes: 1 }), zones))
      .toBe('Hochbeet wurde 1 Minute bewässert.');
    expect(instance.toSentence(run({ status: 'completed', requested_duration_minutes: 12 }), zones))
      .toBe('Hochbeet wurde 12 Minuten bewässert.');
    expect(instance.toSentence(run({ status: 'cancelled' }), zones))
      .toBe('Bewässerung von Hochbeet wurde manuell gestoppt.');
    expect(instance.toSentence(run({ status: 'failed' }), zones))
      .toBe('Bei Hochbeet ist ein Fehler aufgetreten.');
    expect(instance.toSentence(run({ status: 'running' }), zones))
      .toBe('Hochbeet wird gerade bewässert.');
    expect(instance.toSentence(run({ status: 'queued' }), zones))
      .toBe('Für Hochbeet wurde ein Lauf vorbereitet.');
  });

  it('explains skipped runs using weather and sequence context', () => {
    const instance = component();

    expect(instance.toSentence(run({ status: 'skipped', reason: 'Gesamtbewässerung aktiv' }), zones))
      .toBe('Hochbeet wurde einmalig wegen manueller Gesamtbewässerung übersprungen.');
    expect(instance.toSentence(run({
      status: 'skipped',
      weather_decisions: [{ id: 1, decision: 'skip', reason: 'rain', checked_at: '2026-05-20T05:00:00+02:00' }],
    }), zones)).toBe('Hochbeet wurde wegen erwarteten Regens übersprungen.');
    expect(instance.toSentence(run({
      status: 'skipped',
      weather_decisions: [{ id: 1, decision: 'error', reason: 'api', checked_at: '2026-05-20T05:00:00+02:00' }],
    }), zones)).toBe('Hochbeet wurde wegen fehlender Wetterdaten nicht gestartet.');
    expect(instance.toSentence(run({ status: 'skipped' }), zones)).toBe('Hochbeet wurde übersprungen.');
  });

  it('maps history rows to badge statuses and facts', () => {
    const instance = component();

    expect(instance.statusForRun(run({ status: 'failed' }))).toBe('error');
    expect(instance.statusForRun(run({ status: 'running' }))).toBe('watering');
    expect(instance.statusForRun(run({ status: 'completed' }))).toBe('completed');
    expect(instance.statusForRun(run({ status: 'skipped' }))).toBe('skipped');
    expect(instance.statusForRun(run({ status: 'cancelled' }))).toBe('cancelled');
    expect(instance.statusForRun(run({ status: 'queued' }))).toBe('active');

    expect(instance.weatherFacts(run())).toBe('Keine Wetterdaten');
    expect(instance.weatherFacts(run({
      weather_decisions: [{
        id: 1,
        decision: 'skip',
        reason: 'rain',
        checked_at: '2026-05-20T05:00:00+02:00',
        precipitation_probability_max: 82.3,
        precipitation_sum_mm: 2.45,
      }],
    }))).toBe('82 % · 2,5 mm');
    expect(instance.planningReason(run({ reason: 'Manuell gestoppt' }))).toBe('Manuell gestoppt');
    expect(instance.planningReason(run({
      reason: 'Technisch',
      planning_reason: 'Geplant durch KI-Regel',
    }))).toBe('Geplant durch KI-Regel');
    expect(instance.executionReason(run({
      reason: 'Technisch',
      weather_decisions: [{
        id: 1,
        decision: 'skip',
        reason: 'rain',
        reason_human: 'Regen reicht aus',
        checked_at: '2026-05-20T05:00:00+02:00',
      }],
    }))).toBe('Regen reicht aus');
    expect(instance.executionReason(run({ execution_reason: 'Wetter erlaubt Start' }))).toBe('Wetter erlaubt Start');
  });
});
