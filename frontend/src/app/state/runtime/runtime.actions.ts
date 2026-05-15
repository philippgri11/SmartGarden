import { createActionGroup, emptyProps, props } from '@ngrx/store';

import { RuntimeSnapshot, WinterModePayload, Zone } from '../../core/api.models';


export const RuntimeActions = createActionGroup({
  source: 'Runtime',
  events: {
    'Load Requested': props<{ reason?: string }>(),
    'Load Succeeded': props<{ snapshot: RuntimeSnapshot }>(),
    'Load Failed': props<{ error: string }>(),
    'Area Saved Locally': props<{ area: Zone }>(),

    'Start Area Requested': props<{ zoneId: number; durationMinutes: number }>(),
    'Start Area Succeeded': props<{ zoneId: number; runId: number }>(),
    'Start Area Failed': props<{ zoneId: number; error: string }>(),

    'Run All Areas Requested': emptyProps(),
    'Run All Areas Succeeded': props<{ queuedRunCount: number; skippedScheduleCount: number; sequenceGroupId: string }>(),
    'Run All Areas Failed': props<{ error: string }>(),

    'Stop Area Requested': props<{ zoneId: number }>(),
    'Stop Area Succeeded': props<{ zoneId: number }>(),
    'Stop Area Failed': props<{ zoneId: number; error: string }>(),

    'Stop All Requested': emptyProps(),
    'Stop All Succeeded': props<{ stopsRequested: number }>(),
    'Stop All Failed': props<{ error: string }>(),

    'Release Safety Stop Requested': emptyProps(),
    'Release Safety Stop Succeeded': emptyProps(),
    'Release Safety Stop Failed': props<{ error: string }>(),

    'Pause For Hours Requested': props<{ hours: number }>(),
    'Pause For Hours Succeeded': emptyProps(),
    'Pause For Hours Failed': props<{ error: string }>(),

    'Clear Pause Requested': emptyProps(),
    'Clear Pause Succeeded': emptyProps(),
    'Clear Pause Failed': props<{ error: string }>(),

    'Set Winter Mode Requested': props<{ payload: WinterModePayload }>(),
    'Set Winter Mode Succeeded': emptyProps(),
    'Set Winter Mode Failed': props<{ error: string }>(),

    'Set Area Active Requested': props<{ zoneId: number; active: boolean }>(),
    'Set Area Active Succeeded': props<{ zoneId: number; active: boolean }>(),
    'Set Area Active Failed': props<{ zoneId: number; error: string }>(),
  },
});
