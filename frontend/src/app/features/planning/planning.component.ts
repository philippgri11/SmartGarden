import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, switchMap } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { IrrigationProjectionItem } from '../../core/api.models';

@Component({
  standalone: true,
  selector: 'app-planning',
  imports: [CommonModule],
  template: `
    <section class="page-title">
      <h2>Planung</h2>
      <p>Vorschau aus den gespeicherten Regeln: Reihenfolge, Wetterentscheidung und Laufzeit für die nächsten sieben Tage.</p>
    </section>

    <section class="panel" *ngIf="vm$ | async as vm">
      <div class="section-head">
        <div>
          <h3>Nächste Woche</h3>
          <p class="muted">{{ sourceText(vm.weather_source_status) }} · Erstellt {{ formatDateTime(vm.generated_at) }}</p>
        </div>
        <button class="button secondary" type="button" (click)="reload()">Aktualisieren</button>
      </div>

      <div class="planning-summary">
        <div>
          <span>Geplante Läufe</span>
          <strong>{{ countStatus(vm.items, 'planned') }}</strong>
        </div>
        <div>
          <span>Wetterbedingt ausgesetzt</span>
          <strong>{{ countStatus(vm.items, 'skipped') }}</strong>
        </div>
        <div>
          <span>Automatisch verschoben</span>
          <strong>{{ adjustedCount(vm.items) }}</strong>
        </div>
      </div>

      <div class="scenario-table-wrap planning-table-wrap">
        <table class="scenario-table planning-table">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Start</th>
              <th>Ende</th>
              <th>Bereich</th>
              <th>Regel</th>
              <th>Dauer</th>
              <th>Status</th>
              <th>Warum</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let item of vm.items" [class.skipped-row]="item.status !== 'planned'">
              <td>{{ dayLabel(item.planned_start) }}</td>
              <td>
                {{ timeLabel(item.planned_start) }}
                <span class="sequence-note" *ngIf="item.adjusted_for_sequence">verschoben</span>
              </td>
              <td>{{ timeLabel(item.planned_end) }}</td>
              <td>{{ item.zone_name }}</td>
              <td>{{ sourceLabel(item.source) }}</td>
              <td>{{ item.duration_minutes }} min</td>
              <td><span class="status-chip" [class.status-paused]="item.status !== 'planned'">{{ statusLabel(item.status) }}</span></td>
              <td>{{ item.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="muted" *ngIf="vm.items.length === 0">Für die nächsten sieben Tage liegen keine aktiven Regeln vor.</p>
    </section>
  `,
})
export class PlanningComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reload$ = new BehaviorSubject<void>(void 0);

  readonly vm$ = this.reload$.pipe(
    switchMap(() => this.api.getIrrigationProjection(7)),
    takeUntilDestroyed(this.destroyRef)
  );

  reload(): void {
    this.reload$.next();
  }

  countStatus(items: IrrigationProjectionItem[], status: IrrigationProjectionItem['status']): number {
    return items.filter((item) => item.status === status).length;
  }

  adjustedCount(items: IrrigationProjectionItem[]): number {
    return items.filter((item) => item.adjusted_for_sequence).length;
  }

  sourceText(status: 'fresh' | 'stale' | 'unavailable'): string {
    if (status === 'fresh') {
      return 'Wetterdaten wurden geladen';
    }
    if (status === 'stale') {
      return 'Wetterdaten sind älter';
    }
    return 'Wetterdaten nicht verfügbar';
  }

  sourceLabel(source: IrrigationProjectionItem['source']): string {
    return source === 'manual_rule' ? 'Manuell' : 'KI-adaptiv';
  }

  statusLabel(status: IrrigationProjectionItem['status']): string {
    if (status === 'planned') {
      return 'Geplant';
    }
    if (status === 'skipped') {
      return 'Ausgesetzt';
    }
    return 'Blockiert';
  }

  dayLabel(value: string): string {
    return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(value));
  }

  timeLabel(value: string): string {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }

  formatDateTime(value: string): string {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }
}
