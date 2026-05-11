import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import { WinterModePayload } from '../../core/api.models';
import { RuntimeActions } from './runtime.actions';
import { selectRuntimeVm } from './runtime.selectors';


@Injectable({ providedIn: 'root' })
export class RuntimeFacade {
  private readonly store = inject(Store);

  readonly vm$ = this.store.select(selectRuntimeVm);

  load(reason?: string): void {
    this.store.dispatch(RuntimeActions.loadRequested({ reason }));
  }

  startArea(zoneId: number, durationMinutes: number): void {
    this.store.dispatch(RuntimeActions.startAreaRequested({ zoneId, durationMinutes }));
  }

  runAllAreas(): void {
    this.store.dispatch(RuntimeActions.runAllAreasRequested());
  }

  stopArea(zoneId: number): void {
    this.store.dispatch(RuntimeActions.stopAreaRequested({ zoneId }));
  }

  stopAll(): void {
    this.store.dispatch(RuntimeActions.stopAllRequested());
  }

  releaseSafetyStop(): void {
    this.store.dispatch(RuntimeActions.releaseSafetyStopRequested());
  }

  pauseForHours(hours: number): void {
    this.store.dispatch(RuntimeActions.pauseForHoursRequested({ hours }));
  }

  clearPause(): void {
    this.store.dispatch(RuntimeActions.clearPauseRequested());
  }

  setWinterMode(payload: WinterModePayload): void {
    this.store.dispatch(RuntimeActions.setWinterModeRequested({ payload }));
  }

  setAreaActive(zoneId: number, active: boolean): void {
    this.store.dispatch(RuntimeActions.setAreaActiveRequested({ zoneId, active }));
  }
}
