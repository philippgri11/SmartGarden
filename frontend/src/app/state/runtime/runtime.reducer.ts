import { createFeature, createReducer, on } from '@ngrx/store';

import { RuntimeSnapshot } from '../../core/api.models';
import { RuntimeActions } from './runtime.actions';


export type PendingAreaAction = 'starting' | 'stopping' | 'toggling-active';

export interface PendingGlobalActions {
  runAll: boolean;
  stopAll: boolean;
  releaseSafetyStop: boolean;
  pause: boolean;
  winterMode: boolean;
}

export interface RuntimeState {
  snapshot: RuntimeSnapshot | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  pendingAreaActions: Record<number, PendingAreaAction>;
  pendingGlobalActions: PendingGlobalActions;
}

const initialState: RuntimeState = {
  snapshot: null,
  loading: false,
  loaded: false,
  error: null,
  pendingAreaActions: {},
  pendingGlobalActions: {
    runAll: false,
    stopAll: false,
    releaseSafetyStop: false,
    pause: false,
    winterMode: false,
  },
};

function clearAreaPending(
  pendingAreaActions: Record<number, PendingAreaAction>,
  zoneId: number,
): Record<number, PendingAreaAction> {
  const next = { ...pendingAreaActions };
  delete next[zoneId];
  return next;
}

function reconcilePendingAreaActions(
  snapshot: RuntimeSnapshot,
  pendingAreaActions: Record<number, PendingAreaAction>,
): Record<number, PendingAreaAction> {
  const next: Record<number, PendingAreaAction> = {};
  for (const [zoneIdKey, pendingAction] of Object.entries(pendingAreaActions)) {
    const zoneId = Number(zoneIdKey);
    const area = snapshot.areas.find((item) => item.id === zoneId);
    if (!area) {
      continue;
    }
    if (pendingAction === 'starting') {
      if (area.run_state === 'idle') {
        next[zoneId] = pendingAction;
      }
      continue;
    }
    if (pendingAction === 'stopping') {
      if (area.run_state === 'running') {
        next[zoneId] = pendingAction;
      }
      continue;
    }
    next[zoneId] = pendingAction;
  }
  return next;
}

function upsertArea(snapshot: RuntimeSnapshot | null, area: RuntimeSnapshot['areas'][number]): RuntimeSnapshot | null {
  if (!snapshot) {
    return snapshot;
  }
  const exists = snapshot.areas.some((item) => item.id === area.id);
  return {
    ...snapshot,
    areas: exists
      ? snapshot.areas.map((item) => (item.id === area.id ? area : item))
      : [...snapshot.areas, area],
  };
}

export const runtimeFeature = createFeature({
  name: 'runtime',
  reducer: createReducer(
    initialState,
    on(RuntimeActions.loadRequested, (state) => ({
      ...state,
      loading: true,
      error: null,
    })),
    on(RuntimeActions.loadSucceeded, (state, { snapshot }) => ({
      ...state,
      snapshot,
      loading: false,
      loaded: true,
      error: null,
      pendingAreaActions: reconcilePendingAreaActions(snapshot, state.pendingAreaActions),
    })),
    on(RuntimeActions.loadFailed, (state, { error }) => ({
      ...state,
      loading: false,
      loaded: true,
      error,
    })),
    on(RuntimeActions.areaSavedLocally, (state, { area }) => ({
      ...state,
      snapshot: upsertArea(state.snapshot, area),
    })),

    on(RuntimeActions.startAreaRequested, (state, { zoneId }) => ({
      ...state,
      pendingAreaActions: {
        ...state.pendingAreaActions,
        [zoneId]: 'starting' as PendingAreaAction,
      },
      error: null,
    })),
    on(RuntimeActions.startAreaSucceeded, (state) => state),
    on(RuntimeActions.startAreaFailed, (state, { zoneId, error }) => ({
      ...state,
      pendingAreaActions: clearAreaPending(state.pendingAreaActions, zoneId),
      error,
    })),

    on(RuntimeActions.runAllAreasRequested, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, runAll: true },
      error: null,
    })),
    on(RuntimeActions.runAllAreasSucceeded, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, runAll: false },
    })),
    on(RuntimeActions.runAllAreasFailed, (state, { error }) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, runAll: false },
      error,
    })),

    on(RuntimeActions.stopAreaRequested, (state, { zoneId }) => ({
      ...state,
      pendingAreaActions: {
        ...state.pendingAreaActions,
        [zoneId]: 'stopping' as PendingAreaAction,
      },
      error: null,
    })),
    on(RuntimeActions.stopAreaSucceeded, (state) => state),
    on(RuntimeActions.stopAreaFailed, (state, { zoneId, error }) => ({
      ...state,
      pendingAreaActions: clearAreaPending(state.pendingAreaActions, zoneId),
      error,
    })),

    on(RuntimeActions.setAreaActiveRequested, (state, { zoneId }) => ({
      ...state,
      pendingAreaActions: {
        ...state.pendingAreaActions,
        [zoneId]: 'toggling-active' as PendingAreaAction,
      },
      error: null,
    })),
    on(RuntimeActions.setAreaActiveSucceeded, (state, { zoneId }) => ({
      ...state,
      pendingAreaActions: clearAreaPending(state.pendingAreaActions, zoneId),
    })),
    on(RuntimeActions.setAreaActiveFailed, (state, { zoneId, error }) => ({
      ...state,
      pendingAreaActions: clearAreaPending(state.pendingAreaActions, zoneId),
      error,
    })),

    on(RuntimeActions.stopAllRequested, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, stopAll: true },
      error: null,
    })),
    on(RuntimeActions.stopAllSucceeded, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, stopAll: false },
    })),
    on(RuntimeActions.stopAllFailed, (state, { error }) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, stopAll: false },
      error,
    })),

    on(RuntimeActions.releaseSafetyStopRequested, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, releaseSafetyStop: true },
      error: null,
    })),
    on(RuntimeActions.releaseSafetyStopSucceeded, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, releaseSafetyStop: false },
    })),
    on(RuntimeActions.releaseSafetyStopFailed, (state, { error }) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, releaseSafetyStop: false },
      error,
    })),

    on(RuntimeActions.pauseForHoursRequested, RuntimeActions.clearPauseRequested, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, pause: true },
      error: null,
    })),
    on(RuntimeActions.pauseForHoursSucceeded, RuntimeActions.clearPauseSucceeded, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, pause: false },
    })),
    on(RuntimeActions.pauseForHoursFailed, RuntimeActions.clearPauseFailed, (state, { error }) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, pause: false },
      error,
    })),

    on(RuntimeActions.setWinterModeRequested, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, winterMode: true },
      error: null,
    })),
    on(RuntimeActions.setWinterModeSucceeded, (state) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, winterMode: false },
    })),
    on(RuntimeActions.setWinterModeFailed, (state, { error }) => ({
      ...state,
      pendingGlobalActions: { ...state.pendingGlobalActions, winterMode: false },
      error,
    })),
  ),
});

export const {
  name: runtimeFeatureKey,
  reducer: runtimeReducer,
  selectRuntimeState,
  selectSnapshot,
  selectLoading,
  selectLoaded,
  selectError,
  selectPendingAreaActions,
  selectPendingGlobalActions,
} = runtimeFeature;
