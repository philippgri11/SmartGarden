import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoadingService } from './loading.service';

describe('LoadingService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading only after the delay has elapsed', () => {
    const service = new LoadingService();

    service.begin();
    expect(service.visible()).toBe(false);

    vi.advanceTimersByTime(249);
    expect(service.visible()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(service.visible()).toBe(true);
  });

  it('keeps loading visible until all pending operations finish', () => {
    const service = new LoadingService();

    service.begin();
    service.begin();
    vi.advanceTimersByTime(250);
    expect(service.visible()).toBe(true);

    service.end();
    expect(service.visible()).toBe(true);

    service.end();
    expect(service.visible()).toBe(false);
  });

  it('cancels the delay when work finishes quickly', () => {
    const service = new LoadingService();

    service.begin();
    service.end();
    vi.advanceTimersByTime(250);

    expect(service.visible()).toBe(false);
  });
});
