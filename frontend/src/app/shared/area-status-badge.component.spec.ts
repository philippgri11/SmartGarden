import { describe, expect, it } from 'vitest';

import { AreaStatusBadgeComponent } from './area-status-badge.component';

describe('AreaStatusBadgeComponent', () => {
  it.each([
    ['disabled', 'Deaktiviert', 'status-disabled'],
    ['active', 'Bereit', 'status-active'],
    ['watering', 'Läuft', 'status-watering'],
    ['scheduled-soon', 'Bald geplant', 'status-scheduled-soon'],
    ['paused', 'Pausiert', 'status-paused'],
    ['error', 'Eingriff nötig', 'status-error'],
    ['completed', 'Bewässert', 'status-completed'],
    ['skipped', 'Ausgesetzt', 'status-skipped'],
    ['cancelled', 'Gestoppt', 'status-cancelled'],
    ['winter', 'Winterbetrieb', 'status-winter'],
    ['attention', 'Eingriff nötig', 'status-attention'],
  ] as const)('maps %s to German copy and CSS class', (status, label, variantClass) => {
    const component = new AreaStatusBadgeComponent();
    component.status = status;

    expect(component.label).toBe(label);
    expect(component.variantClass).toBe(variantClass);
  });
});
