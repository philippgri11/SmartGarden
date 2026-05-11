import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concat, filter, map, of, switchMap, take, timer } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { RuntimeActions } from './runtime.actions';
import { selectAreaById, selectRuntimeHasTransientActivity } from './runtime.selectors';


function extractErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const detail = (error as { error?: { detail?: string } }).error?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

@Injectable()
export class RuntimeEffects {
  private readonly actions$ = inject(Actions);
  private readonly api = inject(ApiService);
  private readonly store = inject(Store);

  readonly loadRuntime$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.loadRequested),
      switchMap(() =>
        this.api.getRuntimeSnapshot().pipe(
          map((snapshot) => RuntimeActions.loadSucceeded({ snapshot })),
          catchError((error: unknown) =>
            of(RuntimeActions.loadFailed({ error: extractErrorMessage(error, 'Runtime-Daten konnten nicht geladen werden.') })),
          ),
        ),
      ),
    ),
  );

  readonly pollWhileTransient$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.loadSucceeded),
      switchMap(() => this.store.select(selectRuntimeHasTransientActivity).pipe(take(1))),
      filter((hasTransientActivity) => hasTransientActivity),
      switchMap(() => timer(1000).pipe(map(() => RuntimeActions.loadRequested({ reason: 'transient-poll' })))),
    ),
  );

  readonly startArea$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.startAreaRequested),
      switchMap(({ zoneId, durationMinutes }) =>
        this.api.startZone(zoneId, durationMinutes).pipe(
          switchMap((response) =>
            concat(
              of(RuntimeActions.startAreaSucceeded({ zoneId, runId: response.run_id })),
              of(RuntimeActions.loadRequested({ reason: 'start-area' })),
            ),
          ),
          catchError((error: unknown) =>
            of(RuntimeActions.startAreaFailed({ zoneId, error: extractErrorMessage(error, 'Bereich konnte nicht gestartet werden.') })),
          ),
        ),
      ),
    ),
  );

  readonly runAllAreas$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.runAllAreasRequested),
      switchMap(() =>
        this.api.runAllAreas().pipe(
          switchMap((response) =>
            concat(
              of(
                RuntimeActions.runAllAreasSucceeded({
                  queuedRunCount: response.queued_run_count,
                  skippedScheduleCount: response.skipped_schedule_count,
                  sequenceGroupId: response.sequence_group_id,
                }),
              ),
              of(RuntimeActions.loadRequested({ reason: 'run-all-areas' })),
            ),
          ),
          catchError((error: unknown) =>
            of(RuntimeActions.runAllAreasFailed({ error: extractErrorMessage(error, 'Gesamtbewässerung konnte nicht gestartet werden.') })),
          ),
        ),
      ),
    ),
  );

  readonly stopArea$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.stopAreaRequested),
      switchMap(({ zoneId }) =>
        this.api.stopZone(zoneId).pipe(
          switchMap(() =>
            concat(
              of(RuntimeActions.stopAreaSucceeded({ zoneId })),
              of(RuntimeActions.loadRequested({ reason: 'stop-area' })),
            ),
          ),
          catchError((error: unknown) =>
            of(RuntimeActions.stopAreaFailed({ zoneId, error: extractErrorMessage(error, 'Bereich konnte nicht gestoppt werden.') })),
          ),
        ),
      ),
    ),
  );

  readonly stopAll$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.stopAllRequested),
      switchMap(() =>
        this.api.stopAll().pipe(
          switchMap((response) =>
            concat(
              of(RuntimeActions.stopAllSucceeded({ stopsRequested: response.stops_requested })),
              of(RuntimeActions.loadRequested({ reason: 'stop-all' })),
            ),
          ),
          catchError((error: unknown) =>
            of(RuntimeActions.stopAllFailed({ error: extractErrorMessage(error, 'Sicherheitsstopp konnte nicht ausgelöst werden.') })),
          ),
        ),
      ),
    ),
  );

  readonly releaseSafetyStop$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.releaseSafetyStopRequested),
      switchMap(() =>
        this.api.releaseSafetyStop().pipe(
          switchMap(() =>
            concat(
              of(RuntimeActions.releaseSafetyStopSucceeded()),
              of(RuntimeActions.loadRequested({ reason: 'release-safety-stop' })),
            ),
          ),
          catchError((error: unknown) =>
            of(RuntimeActions.releaseSafetyStopFailed({ error: extractErrorMessage(error, 'Sicherheitsstopp konnte nicht aufgehoben werden.') })),
          ),
        ),
      ),
    ),
  );

  readonly pauseForHours$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.pauseForHoursRequested),
      switchMap(({ hours }) =>
        this.api.pauseSystem({ hours }).pipe(
          switchMap(() =>
            concat(
              of(RuntimeActions.pauseForHoursSucceeded()),
              of(RuntimeActions.loadRequested({ reason: 'pause-for-hours' })),
            ),
          ),
          catchError((error: unknown) =>
            of(RuntimeActions.pauseForHoursFailed({ error: extractErrorMessage(error, 'Pause konnte nicht gesetzt werden.') })),
          ),
        ),
      ),
    ),
  );

  readonly clearPause$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.clearPauseRequested),
      switchMap(() =>
        this.api.clearPause().pipe(
          switchMap(() =>
            concat(
              of(RuntimeActions.clearPauseSucceeded()),
              of(RuntimeActions.loadRequested({ reason: 'clear-pause' })),
            ),
          ),
          catchError((error: unknown) =>
            of(RuntimeActions.clearPauseFailed({ error: extractErrorMessage(error, 'Pause konnte nicht aufgehoben werden.') })),
          ),
        ),
      ),
    ),
  );

  readonly setWinterMode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.setWinterModeRequested),
      switchMap(({ payload }) =>
        this.api.updateWinterMode(payload).pipe(
          switchMap(() =>
            concat(
              of(RuntimeActions.setWinterModeSucceeded()),
              of(RuntimeActions.loadRequested({ reason: 'set-winter-mode' })),
            ),
          ),
          catchError((error: unknown) =>
            of(RuntimeActions.setWinterModeFailed({ error: extractErrorMessage(error, 'Winterbetrieb konnte nicht geändert werden.') })),
          ),
        ),
      ),
    ),
  );

  readonly setAreaActive$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RuntimeActions.setAreaActiveRequested),
      switchMap(({ zoneId, active }) =>
        this.store.select(selectAreaById(zoneId)).pipe(
          take(1),
          switchMap((area) => {
            if (!area) {
              return of(RuntimeActions.setAreaActiveFailed({ zoneId, error: 'Bereich konnte nicht gefunden werden.' }));
            }
            return this.api.updateZone(zoneId, {
              name: area.name,
              description: area.description ?? null,
              gpio_chip: area.gpio_chip,
              gpio_line: area.gpio_line,
              active,
              default_manual_duration_minutes: area.default_manual_duration_minutes,
              max_duration_minutes: area.max_duration_minutes,
              weather_enabled: area.weather_enabled,
              weather_probability_threshold: area.weather_probability_threshold ?? null,
              weather_precipitation_mm_threshold: area.weather_precipitation_mm_threshold ?? null,
            }).pipe(
              switchMap(() =>
                concat(
                  of(RuntimeActions.setAreaActiveSucceeded({ zoneId, active })),
                  of(RuntimeActions.loadRequested({ reason: 'set-area-active' })),
                ),
              ),
              catchError((error: unknown) =>
                of(RuntimeActions.setAreaActiveFailed({ zoneId, error: extractErrorMessage(error, 'Bereich konnte nicht aktualisiert werden.') })),
              ),
            );
          }),
        ),
      ),
    ),
  );
}
