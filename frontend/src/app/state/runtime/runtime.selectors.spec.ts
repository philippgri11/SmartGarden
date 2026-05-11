import { describe, expect, it } from 'vitest';

import { RuntimeSnapshot } from '../../core/api.models';
import { runtimeFeatureKey } from './runtime.reducer';
import { selectAreaById, selectRuntimeHasTransientActivity, selectRuntimeVm } from './runtime.selectors';


const snapshot: RuntimeSnapshot = {
  generated_at: '2026-05-11T06:30:00Z',
  settings: {
    location_name: 'Testgarten',
    postal_code: '10115',
    latitude: 52.52,
    longitude: 13.405,
    weather_enabled: true,
    weather_window_hours: 6,
    weather_probability_threshold: 70,
    weather_precipitation_mm_threshold: 2,
    weather_fail_mode: 'allow',
    winter_mode_active: false,
    winter_disable_manual_start: true,
    winter_pause_schedules: true,
    safety_shutdown_on_winter: true,
    system_paused_until: null,
    safety_stop_active: false,
    safety_stop_reason: null,
  },
  summary: {
    status: 'running',
    headline: 'Bewässerung wird vorbereitet',
    detail: 'Ein Lauf wurde angefordert und wird vom Worker übernommen.',
    current_water_status: 'wird vorbereitet',
    next_watering_at: null,
    weather_status: 'Wettersteuerung aktiv',
    weather_overview: {
      weather_enabled: true,
      decision: 'allow',
      headline: 'Bewässerung wetterseitig möglich',
      summary_text: 'Kein kritischer Regen erwartet. Nächste 6 Std.: 20 % Regenwahrscheinlichkeit · 0,0 mm',
      forecast_window_hours: 6,
      precipitation_probability_max: 20,
      precipitation_sum_mm: 0,
      probability_threshold: 70,
      precipitation_threshold_mm: 2,
      fail_mode: 'allow',
      source_status: 'fresh',
      checked_at: '2026-05-11T06:20:00Z',
      reason_human: 'Kein kritischer Regen erwartet.',
    },
    active_schedule_count: 1,
    running_zone_count: 0,
    winter_mode_active: false,
    safety_stop_active: false,
    system_paused_until: null,
    last_run_zone_name: null,
    last_run_finished_at: null,
    last_run_status: null,
    manual_sequence_active: false,
    manual_sequence_current_area_name: null,
    manual_sequence_total_areas: 0,
    manual_sequence_completed_areas: 0,
    manual_sequence_skipped_schedule_count: 0,
    manual_sequence_notice: null,
  },
  areas: [
    {
      id: 1,
      name: 'Rasen',
      description: null,
      gpio_chip: '/dev/gpiochip0',
      gpio_line: 12,
      active: true,
      default_manual_duration_minutes: 5,
      max_duration_minutes: 10,
      weather_enabled: false,
      weather_probability_threshold: null,
      weather_precipitation_mm_threshold: null,
      status: 'scheduled-soon',
      run_state: 'queued',
      running: false,
      current_run_id: 11,
      current_run_status: 'planned',
      current_run_started_at: null,
      current_run_requested_duration_minutes: 5,
      current_run_remaining_seconds: null,
      current_run_stop_requested: false,
      last_known_gpio_state: false,
      last_gpio_changed_at: null,
      next_watering_at: null,
      last_watering_at: null,
      last_run_status: null,
      last_weather_decision: null,
      last_weather_reason: null,
      weather_decision_effective: false,
      weather_decision: 'inactive',
      weather_reason_human: 'Wettersteuerung ist ausgeschaltet.',
      weather_snapshot: {
        weather_enabled: false,
        decision: 'inactive',
        headline: 'Wettersteuerung aus',
        summary_text: 'Wetter wird für automatische Entscheidungen derzeit nicht berücksichtigt.',
        forecast_window_hours: 6,
        precipitation_probability_max: null,
        precipitation_sum_mm: null,
        probability_threshold: 70,
        precipitation_threshold_mm: 2,
        fail_mode: 'allow',
        source_status: 'unavailable',
        checked_at: null,
        reason_human: 'Wettersteuerung ist ausgeschaltet.',
      },
      manual_start_allowed: false,
      manual_start_block_reason: 'Der Start wurde bereits angefordert.',
      active_shape_count: 1,
    },
  ],
};

describe('runtime selectors', () => {
  const state = {
    [runtimeFeatureKey]: {
      snapshot,
      loading: false,
      loaded: true,
      error: null,
      pendingAreaActions: {},
        pendingGlobalActions: {
          runAll: false,
          stopAll: false,
          releaseSafetyStop: false,
          pause: false,
          winterMode: false,
        },
    },
  };

  it('exposes a ready runtime view model with snapshot data', () => {
    const vm = selectRuntimeVm(state);

    expect(vm.ready).toBe(true);
    expect(vm.summary.headline).toBe('Bewässerung wird vorbereitet');
    expect(vm.areas).toHaveLength(1);
  });

  it('reports transient activity for queued runs', () => {
    expect(selectRuntimeHasTransientActivity(state)).toBe(true);
  });

  it('finds an area by zone id', () => {
    const area = selectAreaById(1)(state);

    expect(area?.name).toBe('Rasen');
    expect(area?.run_state).toBe('queued');
  });

  it('derives an immediate preparing system status from a pending start request', () => {
    const pendingState = {
      [runtimeFeatureKey]: {
        ...state[runtimeFeatureKey],
        snapshot: {
          ...snapshot,
          summary: {
            ...snapshot.summary,
            status: 'ok',
            headline: 'Alles in Ordnung',
            detail: 'Das System ist bereit für die nächste Bewässerung.',
            current_water_status: 'aus',
          },
          areas: snapshot.areas.map((area) => ({
            ...area,
            status: 'active',
            run_state: 'idle',
            manual_start_allowed: true,
            manual_start_block_reason: null,
          })),
        },
        pendingAreaActions: { 1: 'starting' },
      },
    };

    const vm = selectRuntimeVm(pendingState);

    expect(vm.summary.headline).toBe('Bewässerung wird vorbereitet');
    expect(vm.summary.current_water_status).toBe('wird vorbereitet');
    expect(vm.areas[0].run_state).toBe('queued');
  });

  it('derives a preparing summary for a pending run-all action', () => {
    const pendingRunAllState = {
      [runtimeFeatureKey]: {
        ...state[runtimeFeatureKey],
        pendingGlobalActions: {
          ...state[runtimeFeatureKey].pendingGlobalActions,
          runAll: true,
        },
      },
    };

    const vm = selectRuntimeVm(pendingRunAllState);

    expect(vm.summary.headline).toBe('Gesamtbewässerung wird vorbereitet');
    expect(vm.summary.manual_sequence_active).toBe(true);
  });

  it('prefers a running area over a stale preparing summary', () => {
    const staleSummaryState = {
      [runtimeFeatureKey]: {
        ...state[runtimeFeatureKey],
        snapshot: {
          ...snapshot,
          summary: {
            ...snapshot.summary,
            status: 'running',
            headline: 'Bewässerung wird vorbereitet',
            detail: 'Ein Lauf wurde angefordert und wird vom Worker übernommen.',
            current_water_status: 'wird vorbereitet',
          },
          areas: snapshot.areas.map((area) => ({
            ...area,
            status: 'watering',
            run_state: 'running',
            running: true,
            current_run_started_at: '2026-05-11T06:31:00Z',
            current_run_remaining_seconds: 110,
          })),
        },
      },
    };

    const vm = selectRuntimeVm(staleSummaryState);

    expect(vm.summary.headline).toBe('Bewässerung läuft');
    expect(vm.summary.detail).toBe('Mindestens ein Bereich wird gerade bewässert.');
    expect(vm.summary.current_water_status).toBe('läuft');
  });
});
