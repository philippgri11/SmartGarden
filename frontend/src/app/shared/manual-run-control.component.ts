import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-manual-run-control',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="manual-run-control">
      <div class="manual-run-head">
        <div>
          <div class="eyebrow">Manuelle Bewässerung</div>
          <strong *ngIf="runState === 'idle'">{{ duration }} {{ duration === 1 ? 'Minute' : 'Minuten' }}</strong>
          <strong *ngIf="runState === 'queued'">Start wird vorbereitet</strong>
          <strong *ngIf="runState === 'running'">{{ runningLabel || 'Bewässerung läuft gerade' }}</strong>
          <strong *ngIf="runState === 'stopping'">Bewässerung wird gestoppt</strong>
        </div>
        <div class="manual-run-meta" *ngIf="runState === 'idle'">Max. {{ maxMinutes }} min</div>
        <div class="manual-run-meta" *ngIf="runState === 'running' || runState === 'stopping'">
          {{ remainingText() }}
        </div>
      </div>

      <input
        *ngIf="runState === 'idle'"
        class="duration-slider"
        type="range"
        [min]="1"
        [max]="maxMinutes"
        [value]="duration"
        [disabled]="disabled"
        (input)="onInput(($any($event.target)).value)"
      />

      <div class="manual-run-actions">
        <button class="button" type="button" *ngIf="runState === 'idle'" [disabled]="disabled" (click)="start.emit()">
          {{ disabled ? (disabledReason || 'Start derzeit nicht möglich') : startButtonLabel(duration) }}
        </button>
        <button class="button secondary" type="button" *ngIf="runState === 'queued'" disabled>Start wird vorbereitet</button>
        <button class="button danger" type="button" *ngIf="runState === 'running'" (click)="stop.emit()">Stoppen</button>
        <button class="button secondary" type="button" *ngIf="runState === 'stopping'" disabled>Wird gestoppt</button>
      </div>

      <p class="muted" *ngIf="runState === 'idle' && disabled && disabledReason">{{ disabledReason }}</p>
    </div>
  `,
})
export class ManualRunControlComponent {
  @Input() duration = 5;
  @Input() maxMinutes = 10;
  @Input() disabled = false;
  @Input() disabledReason = '';
  @Input() running = false;
  @Input() runState: 'idle' | 'queued' | 'running' | 'stopping' = 'idle';
  @Input() runningLabel = '';
  @Input() remainingSeconds: number | null = null;
  @Output() durationChange = new EventEmitter<number>();
  @Output() start = new EventEmitter<void>();
  @Output() stop = new EventEmitter<void>();

  onInput(value: string): void {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      this.durationChange.emit(parsed);
    }
  }

  startButtonLabel(value: number): string {
    return `Start für ${value} ${value === 1 ? 'Minute' : 'Minuten'}`;
  }

  remainingText(): string {
    if (this.runState === 'stopping') {
      return 'Ventil schließt';
    }
    if (this.remainingSeconds === null) {
      return 'Läuft';
    }
    const minutes = Math.ceil(this.remainingSeconds / 60);
    return `Rest ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
  }
}
