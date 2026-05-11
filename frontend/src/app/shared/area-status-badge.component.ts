import { CommonModule, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-area-status-badge',
  standalone: true,
  imports: [CommonModule, NgClass],
  template: `<span class="status-chip" [ngClass]="variantClass">{{ label }}</span>`,
})
export class AreaStatusBadgeComponent {
  @Input({ required: true }) status:
    | 'disabled'
    | 'active'
    | 'watering'
    | 'scheduled-soon'
    | 'paused'
    | 'error'
    | 'ok'
    | 'running'
    | 'winter'
    | 'attention' = 'ok';

  get label(): string {
    switch (this.status) {
      case 'disabled':
        return 'Deaktiviert';
      case 'active':
      case 'ok':
        return 'Bereit';
      case 'watering':
      case 'running':
        return 'Läuft';
      case 'scheduled-soon':
        return 'Bald geplant';
      case 'paused':
        return 'Pausiert';
      case 'winter':
        return 'Winterbetrieb';
      case 'attention':
      case 'error':
        return 'Eingriff nötig';
      default:
        return 'Bereit';
    }
  }

  get variantClass(): string {
    return `status-${this.status}`;
  }
}
