import { createSelector } from '@ngrx/store';

import { AppSettings, SystemSummary, WeatherOverview, Zone } from '../../core/api.models';
import {
  selectError,
  selectLoaded,
  selectLoading,
  selectPendingAreaActions,
  selectPendingGlobalActions,
  selectSnapshot,
} from './runtime.reducer';


const defaultSettings: AppSettings = {
  location_name: 'Mein Garten',
  postal_code: null,
  latitude: 0,
  longitude: 0,
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
};

const defaultSummary: SystemSummary = {
  status: 'ok',
  headline: 'Lade Systemstatus',
  detail: 'Die aktuellen Zustände werden geladen.',
  current_water_status: 'unbekannt',
  next_watering_at: null,
  weather_status: 'Wetterstatus wird geladen',
  weather_overview: {
    weather_enabled: true,
    decision: 'unknown',
    headline: 'Wetter wird geprüft',
    summary_text: 'Die Wetterdaten werden geladen.',
    forecast_window_hours: 6,
    precipitation_probability_max: null,
    precipitation_sum_mm: null,
    probability_threshold: 70,
    precipitation_threshold_mm: 2,
    fail_mode: 'allow',
    source_status: 'unavailable',
    checked_at: null,
    reason_human: 'Für die aktuelle Wetterlage liegen noch keine Daten vor.',
  } satisfies WeatherOverview,
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
};

export const selectRuntimeSummary = createSelector(
  selectSnapshot,
  (snapshot) => snapshot?.summary ?? defaultSummary,
);

export const selectRuntimeSettings = createSelector(
  selectSnapshot,
  (snapshot) => snapshot?.settings ?? defaultSettings,
);

export const selectRuntimeAreas = createSelector(
  selectSnapshot,
  (snapshot): Zone[] => snapshot?.areas ?? [],
);

export const selectDisplayedRuntimeAreas = createSelector(
  selectRuntimeAreas,
  selectPendingAreaActions,
  (areas, pendingAreaActions): Zone[] =>
    areas.map((area) => {
      const pending = pendingAreaActions[area.id];
      if (pending === 'starting' && area.run_state === 'idle') {
        return {
          ...area,
          status: 'scheduled-soon',
          run_state: 'queued',
          manual_start_allowed: false,
          manual_start_block_reason: 'Der Start wurde bereits angefordert.',
        };
      }
      if (pending === 'stopping' && area.run_state === 'running') {
        return {
          ...area,
          run_state: 'stopping',
          current_run_stop_requested: true,
        };
      }
      return area;
    }),
);

export const selectDisplayedRuntimeSummary = createSelector(
  selectRuntimeSummary,
  selectRuntimeSettings,
  selectDisplayedRuntimeAreas,
  selectPendingGlobalActions,
  (summary, settings, areas, pendingGlobalActions): SystemSummary => {
    const nextRunningCount = areas.filter((area) => area.run_state === 'running' || area.run_state === 'stopping').length;
    const hasQueuedArea = areas.some((area) => area.run_state === 'queued');
    const hasRunningArea = nextRunningCount > 0;
    const hasStoppingArea = areas.some((area) => area.run_state === 'stopping');

    if (pendingGlobalActions.stopAll) {
      return {
        ...summary,
        status: 'attention',
        headline: 'Bewässerung wird gestoppt',
        detail: 'Alle Ventile werden geschlossen.',
        current_water_status: 'wird gestoppt',
        safety_stop_active: true,
      };
    }
    if (pendingGlobalActions.runAll) {
      return {
        ...summary,
        status: 'running',
        headline: 'Gesamtbewässerung wird vorbereitet',
        detail: 'Alle freigegebenen Bereiche werden nacheinander vorbereitet.',
        current_water_status: 'wird vorbereitet',
        manual_sequence_active: true,
      };
    }
    if (settings.safety_stop_active) {
      return {
        ...summary,
        status: 'attention',
        headline: 'Bewässerung gestoppt',
        detail: settings.safety_stop_reason || 'Alle Ventile sind geschlossen.',
        current_water_status: 'aus',
        safety_stop_active: true,
      };
    }
    if (settings.winter_mode_active) {
      return {
        ...summary,
        status: 'winter',
        headline: 'Winterbetrieb aktiv',
        detail: 'Automatische Bewässerung ist ausgeschaltet. Alle Ventile sind geschlossen.',
        current_water_status: 'aus',
      };
    }
    if (settings.system_paused_until && new Date(settings.system_paused_until).getTime() > Date.now()) {
      return {
        ...summary,
        status: 'paused',
        headline: 'Bewässerung pausiert',
        detail: `Pausiert bis ${settings.system_paused_until}.`,
        current_water_status: 'aus',
      };
    }
    if (hasRunningArea) {
      return {
        ...summary,
        status: 'running',
        headline: hasStoppingArea
          ? 'Bewässerung wird gestoppt'
          : summary.manual_sequence_active
            ? 'Gesamtbewässerung läuft'
            : 'Bewässerung läuft',
        detail: hasStoppingArea
          ? 'Mindestens ein Bereich wird gerade gestoppt.'
          : summary.manual_sequence_active && summary.manual_sequence_current_area_name
            ? `${summary.manual_sequence_current_area_name} wird gerade bewässert.`
            : 'Mindestens ein Bereich wird gerade bewässert.',
        current_water_status: hasStoppingArea ? 'wird gestoppt' : 'läuft',
        running_zone_count: nextRunningCount,
      };
    }
    if (hasQueuedArea) {
      return {
        ...summary,
        status: 'running',
        headline: summary.manual_sequence_active ? 'Gesamtbewässerung wird vorbereitet' : 'Bewässerung wird vorbereitet',
        detail: summary.manual_sequence_active && summary.manual_sequence_current_area_name
          ? `${summary.manual_sequence_current_area_name} ist als nächstes an der Reihe.`
          : 'Ein Lauf wurde angefordert und wird vom Worker übernommen.',
        current_water_status: 'wird vorbereitet',
        running_zone_count: 0,
      };
    }
    return {
      ...summary,
      status: 'ok',
      headline: 'Alles in Ordnung',
      detail: 'Das System ist bereit für die nächste Bewässerung.',
      current_water_status: 'aus',
      running_zone_count: 0,
    };
  },
);

export const selectRuntimeVm = createSelector(
  selectDisplayedRuntimeSummary,
  selectRuntimeSettings,
  selectDisplayedRuntimeAreas,
  selectPendingAreaActions,
  selectPendingGlobalActions,
  selectLoading,
  selectLoaded,
  selectError,
  (summary, settings, areas, pendingAreaActions, pendingGlobalActions, loading, loaded, error) => ({
    summary,
    settings,
    areas,
    pendingAreaActions,
    pendingGlobalActions,
    loading,
    loaded,
    error,
    ready: loaded,
  }),
);

export const selectRuntimeHasTransientActivity = createSelector(
  selectRuntimeAreas,
  (areas) => areas.some((area) => ['queued', 'running', 'stopping'].includes(area.run_state)),
);

export const selectAreaById = (zoneId: number) => createSelector(
  selectRuntimeAreas,
  (areas) => areas.find((area) => area.id === zoneId) ?? null,
);
