import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-winter-mode-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="winter-banner" *ngIf="active">
      <div>
        <strong>Winterbetrieb aktiv.</strong>
        <span>Automatische Bewässerung ist ausgeschaltet. Alle Ventile sind geschlossen.</span>
      </div>
      <button class="button secondary" type="button" (click)="disable.emit()">Winterbetrieb beenden</button>
    </section>
  `,
})
export class WinterModeBannerComponent {
  @Input() active = false;
  @Output() disable = new EventEmitter<void>();
}
