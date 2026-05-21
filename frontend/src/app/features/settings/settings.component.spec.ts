import { describe, expect, it, vi } from 'vitest';

import { SettingsComponent } from './settings.component';

function component(): SettingsComponent {
  return Object.create(SettingsComponent.prototype) as SettingsComponent;
}

describe('SettingsComponent display helpers', () => {
  it('formats pod resources and creation dates', () => {
    const instance = component();

    expect(instance.formatCpu(null)).toBe('keine Metrics');
    expect(instance.formatCpu(24.6)).toBe('25 mCPU');
    expect(instance.formatMemory(undefined)).toBe('keine Metrics');
    expect(instance.formatMemory(64.25)).toBe('64,3 MiB');
    expect(instance.formatPodCreatedAt(null)).toBe('-');
    expect(instance.formatPodCreatedAt('not-a-date')).toBe('-');
    expect(instance.formatPodCreatedAt('2026-05-21T10:30:00Z')).toContain('21.05.26');
  });

  it('formats pod age labels', () => {
    const instance = component();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T12:00:00Z'));

    expect(instance.podAgeLabel(null)).toBe('');
    expect(instance.podAgeLabel('not-a-date')).toBe('');
    expect(instance.podAgeLabel('2026-05-21T11:59:45Z')).toBe('gerade erstellt');
    expect(instance.podAgeLabel('2026-05-21T11:25:00Z')).toBe('seit 35 Min.');
    expect(instance.podAgeLabel('2026-05-21T03:00:00Z')).toBe('seit 9 Std.');
    expect(instance.podAgeLabel('2026-05-18T10:00:00Z')).toBe('seit 3 Tagen');

    vi.useRealTimers();
  });

  it('detects meaningful coordinate changes', () => {
    const privateInstance = component() as unknown as {
      coordinatesDiffer: (left: number, right: number) => boolean;
    };

    expect(privateInstance.coordinatesDiffer(52.52, 52.520001)).toBe(false);
    expect(privateInstance.coordinatesDiffer(52.52, 52.5201)).toBe(true);
  });
});
