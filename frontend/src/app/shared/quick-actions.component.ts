import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-quick-actions',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="quick-actions">
      <button class="button quick-action-primary" type="button" (click)="runAllAreas.emit()">Jetzt bewässern</button>
      <div class="quick-actions-secondary">
        <button class="button danger quick-action-mobile-only" type="button" (click)="stopAll.emit()">Alles stoppen</button>
        <button class="button secondary" type="button" *ngIf="safetyStopActive" (click)="releaseSafetyStop.emit()">
          System wieder freigeben
        </button>
        <button class="button secondary" type="button" (click)="pause24h.emit()">
          {{ paused ? 'Pause beenden' : '24h pausieren' }}
        </button>
      </div>
    </section>
  `,
})
export class QuickActionsComponent {
  @Input() paused = false;
  @Input() safetyStopActive = false;
  @Output() runAllAreas = new EventEmitter<void>();
  @Output() stopAll = new EventEmitter<void>();
  @Output() releaseSafetyStop = new EventEmitter<void>();
  @Output() pause24h = new EventEmitter<void>();
}
