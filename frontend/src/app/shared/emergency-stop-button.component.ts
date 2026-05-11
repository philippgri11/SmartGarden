import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-emergency-stop-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button class="button danger emergency-stop" [class.emergency-stop-compact]="compact" type="button" (click)="trigger.emit()">
      {{ label }}
    </button>
  `,
})
export class EmergencyStopButtonComponent {
  @Input() label = 'Alles stoppen';
  @Input() compact = false;
  @Output() trigger = new EventEmitter<void>();
}
