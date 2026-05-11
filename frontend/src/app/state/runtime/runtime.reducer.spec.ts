import { describe, expect, it } from 'vitest';

import { RuntimeActions } from './runtime.actions';
import { runtimeReducer } from './runtime.reducer';


describe('runtimeReducer', () => {
  it('marks an area as pending while a start is requested', () => {
    const state = runtimeReducer(undefined, RuntimeActions.startAreaRequested({ zoneId: 7, durationMinutes: 4 }));

    expect(state.pendingAreaActions[7]).toBe('starting');
    expect(state.error).toBeNull();
  });

  it('keeps a pending start until runtime data confirms the new state', () => {
    const requested = runtimeReducer(undefined, RuntimeActions.startAreaRequested({ zoneId: 7, durationMinutes: 4 }));
    const succeeded = runtimeReducer(requested, RuntimeActions.startAreaSucceeded({ zoneId: 7, runId: 99 }));

    expect(succeeded.pendingAreaActions[7]).toBe('starting');
  });

  it('reconciles pending start state after runtime snapshot confirms the queued run', () => {
    const requested = runtimeReducer(undefined, RuntimeActions.startAreaRequested({ zoneId: 7, durationMinutes: 4 }));
    const loaded = runtimeReducer(
      requested,
      RuntimeActions.loadSucceeded({
        snapshot: {
          generated_at: '2026-05-11T08:00:00Z',
          settings: {
            location_name: 'Testgarten',
            postal_code: null,
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
            detail: 'Ein Lauf wurde angefordert und wird gestartet.',
            current_water_status: 'wird vorbereitet',
            next_watering_at: null,
            weather_status: 'Wettersteuerung aktiv',
            weather_overview: {
              weather_enabled: true,
              decision: 'allow',
              headline: 'Bewässerung wetterseitig möglich',
              summary_text: 'Kein kritischer Regen erwartet.',
              forecast_window_hours: 6,
              precipitation_probability_max: 20,
              precipitation_sum_mm: 0,
              probability_threshold: 70,
              precipitation_threshold_mm: 2,
              fail_mode: 'allow',
              source_status: 'fresh',
              checked_at: '2026-05-11T08:00:00Z',
              reason_human: 'Kein kritischer Regen erwartet.',
            },
            active_schedule_count: 0,
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
              id: 7,
              name: 'Testbereich',
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
              current_run_id: 3,
              current_run_status: 'planned',
              current_run_started_at: null,
              current_run_requested_duration_minutes: 4,
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
              active_shape_count: 0,
            },
          ],
        },
      }),
    );

    expect(loaded.pendingAreaActions[7]).toBeUndefined();
  });

  it('tracks global safety-stop mutations separately', () => {
    const requested = runtimeReducer(undefined, RuntimeActions.stopAllRequested());
    const succeeded = runtimeReducer(requested, RuntimeActions.stopAllSucceeded({ stopsRequested: 2 }));

    expect(requested.pendingGlobalActions.stopAll).toBe(true);
    expect(succeeded.pendingGlobalActions.stopAll).toBe(false);
  });

  it('tracks run-all mutations separately', () => {
    const requested = runtimeReducer(undefined, RuntimeActions.runAllAreasRequested());
    const succeeded = runtimeReducer(
      requested,
      RuntimeActions.runAllAreasSucceeded({ queuedRunCount: 3, skippedScheduleCount: 1, sequenceGroupId: 'seq-1' }),
    );

    expect(requested.pendingGlobalActions.runAll).toBe(true);
    expect(succeeded.pendingGlobalActions.runAll).toBe(false);
  });
});
