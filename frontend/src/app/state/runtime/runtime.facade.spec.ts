import { describe, expect, it, vi } from 'vitest';

import { Zone } from '../../core/api.models';
import { RuntimeFacade } from './runtime.facade';

function createFacade(): { facade: RuntimeFacade; dispatched: unknown[] } {
  const dispatched: unknown[] = [];
  const store = {
    select: vi.fn(() => 'vm$'),
    dispatch: vi.fn((action: unknown) => dispatched.push(action)),
  };
  const facade = Object.create(RuntimeFacade.prototype) as RuntimeFacade & {
    store: typeof store;
    vm$: string;
  };
  facade.store = store;
  facade.vm$ = store.select();
  return { facade, dispatched };
}

describe('RuntimeFacade', () => {
  it('dispatches load and local area update actions', () => {
    const { facade, dispatched } = createFacade();
    const area = { id: 3, name: 'Hochbeet' } as Zone;

    facade.load('manual-refresh');
    facade.areaSavedLocally(area);

    expect(dispatched).toMatchObject([
      { type: '[Runtime] Load Requested', reason: 'manual-refresh' },
      { type: '[Runtime] Area Saved Locally', area },
    ]);
  });

  it('dispatches watering control actions', () => {
    const { facade, dispatched } = createFacade();

    facade.startArea(3, 12);
    facade.runAllAreas();
    facade.stopArea(3);
    facade.stopAll();
    facade.releaseSafetyStop();

    expect(dispatched).toMatchObject([
      { type: '[Runtime] Start Area Requested', zoneId: 3, durationMinutes: 12 },
      { type: '[Runtime] Run All Areas Requested' },
      { type: '[Runtime] Stop Area Requested', zoneId: 3 },
      { type: '[Runtime] Stop All Requested' },
      { type: '[Runtime] Release Safety Stop Requested' },
    ]);
  });

  it('dispatches system mode actions', () => {
    const { facade, dispatched } = createFacade();
    const winterPayload = {
      active: true,
      disable_manual_start: true,
      pause_schedules: true,
      safety_shutdown: true,
    };

    facade.pauseForHours(24);
    facade.clearPause();
    facade.setWinterMode(winterPayload);
    facade.setAreaActive(3, false);

    expect(dispatched).toMatchObject([
      { type: '[Runtime] Pause For Hours Requested', hours: 24 },
      { type: '[Runtime] Clear Pause Requested' },
      { type: '[Runtime] Set Winter Mode Requested', payload: winterPayload },
      { type: '[Runtime] Set Area Active Requested', zoneId: 3, active: false },
    ]);
  });
});
