import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
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
          <p class="notice warning" *ngIf="vm.weather_source_status === 'unavailable'">
            Wetterdaten fehlen. Die Vorschau nutzt gespeicherte Regeln und Zonenprofile; reale Regenprognosen konnten nicht eingerechnet werden.
          </p>
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

      <div class="planning-tabs" role="tablist" aria-label="Planungsansichten">
        <button type="button" [class.active]="activeTab() === 'runs'" (click)="activeTab.set('runs')">Läufe</button>
        <button type="button" [class.active]="activeTab() === 'weather'" (click)="activeTab.set('weather')">Wetterbasis KI</button>
      </div>

      <div class="scenario-table-wrap planning-table-wrap" *ngIf="activeTab() === 'runs'">
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
              <th>Wetter</th>
              <th>Warum</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let item of vm.items" [class.skipped-row]="item.status !== 'planned'">
              <td data-label="Tag">{{ dayLabel(item.planned_start) }}</td>
              <td data-label="Start">
                {{ timeLabel(item.planned_start) }}
                <span class="sequence-note" *ngIf="item.adjusted_for_sequence">verschoben</span>
              </td>
              <td data-label="Ende">{{ timeLabel(item.planned_end) }}</td>
              <td data-label="Bereich">{{ item.zone_name }}</td>
              <td data-label="Regel">{{ sourceLabel(item.source) }}</td>
              <td data-label="Dauer">{{ item.duration_minutes }} min</td>
              <td data-label="Status"><span class="status-chip" [class.status-paused]="item.status !== 'planned'">{{ statusLabel(item.status) }}</span></td>
              <td data-label="Wetter">{{ item.weather_summary ?? 'Keine Wetterangabe' }}</td>
              <td data-label="Warum">
                <strong class="reason-title">{{ userReason(item) }}</strong>
                <span class="reason-detail" *ngIf="item.decision_summary && item.decision_summary !== userReason(item)">
                  {{ item.decision_summary }}
                </span>
                <span class="reason-detail" *ngIf="item.adjusted_for_sequence">
                  Start wurde nach hinten geschoben, damit nie zwei Bereiche gleichzeitig bewässern.
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="weather-basis-view" *ngIf="activeTab() === 'weather'">
        <p class="muted">
          Diese Werte kommen aus dem Backend und werden für KI-adaptive Entscheidungen verwendet. So siehst du,
          ob ein Lauf wegen echtem Regen, erwarteter Prognose, Mindestabstand oder Tageslimit ausgesetzt wurde.
        </p>
        <div class="weather-basis-grid">
          <article class="weather-basis-card" *ngFor="let item of adaptiveItems(vm.items)">
            <div class="weather-basis-head">
              <div>
                <span class="eyebrow">{{ dayLabel(item.planned_start) }} · {{ timeLabel(item.original_start) }}</span>
                <h4>{{ item.zone_name }}</h4>
              </div>
              <span class="status-chip" [class.status-paused]="item.status !== 'planned'">{{ statusLabel(item.status) }}</span>
            </div>
            <p class="decision-copy">{{ item.decision_summary || userReason(item) }}</p>
            <dl class="weather-metrics" *ngIf="item.weather_basis as basis">
              <div><dt>Wetterquelle</dt><dd>{{ basisSourceLabel(basis) }}</dd></div>
              <div><dt>Temperatur max.</dt><dd>{{ numberValue(basis, 'temperature_max_24h_c', '°C') }}</dd></div>
              <div><dt>Regen letzte 24h</dt><dd>{{ numberValue(basis, 'rain_last_24h_mm', 'mm') }}</dd></div>
              <div><dt>Regen nächste 24h</dt><dd>{{ numberValue(basis, 'rain_next_24h_mm', 'mm') }}</dd></div>
              <div><dt>Bewölkung</dt><dd>{{ numberValue(basis, 'cloud_cover_avg_pct', '%') }}</dd></div>
              <div><dt>Wirksamer Regen</dt><dd>{{ numberValue(basis, 'effective_rain_mm', 'mm') }}</dd></div>
              <div><dt>Netto-Bedarf</dt><dd>{{ numberValue(basis, 'net_need_mm', 'mm') }}</dd></div>
              <div><dt>Laufzeitfaktor</dt><dd>{{ numberValue(basis, 'duration_multiplier', '×') }}</dd></div>
              <div><dt>Basisdauer</dt><dd>{{ numberValue(basis, 'base_duration_minutes', 'min') }}</dd></div>
            </dl>
            <div class="rule-context" *ngIf="item.weather_basis as basis">
              <span>Zeitfenster: {{ windowLabels(basis) }}</span>
              <span>Zweiter Tageslauf: {{ boolValue(basis, 'allow_second_daily_run') ? 'erlaubt' : 'nicht erlaubt' }}</span>
              <span>Mindestabstand: {{ numberValue(basis, 'min_interval_hours', 'Std.') }}</span>
              <span>Regen-Skip ab: {{ numberValue(basis, 'rain_skip_threshold_mm', 'mm') }}</span>
              <span>Regen-Verzögerung ab: {{ numberValue(basis, 'rain_delay_threshold_mm', 'mm') }}</span>
              <span>Heute schon automatisch: {{ boolValue(basis, 'already_watered_today') ? 'ja' : 'nein' }}</span>
            </div>
            <ul class="decision-details" *ngIf="item.decision_details.length">
              <li *ngFor="let detail of item.decision_details">{{ detail }}</li>
            </ul>
          </article>
        </div>
        <p class="muted" *ngIf="adaptiveItems(vm.items).length === 0">Für die nächsten sieben Tage gibt es keine KI-adaptiven Läufe.</p>
      </div>

      <p class="muted" *ngIf="vm.items.length === 0">Für die nächsten sieben Tage liegen keine aktiven Regeln vor.</p>
    </section>
  `,
  styles: [`
    .planning-tabs {
      display: flex;
      gap: 8px;
      margin: 22px 0 14px;
      overflow-x: auto;
    }

    .planning-tabs button {
      border: 1px solid var(--border);
      background: var(--surface-strong);
      color: var(--text);
      border-radius: 999px;
      padding: 10px 16px;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .planning-tabs button.active {
      background: var(--primary);
      border-color: var(--primary);
      color: white;
    }

    .reason-title {
      display: block;
      font-weight: 700;
    }

    .reason-detail {
      display: block;
      color: var(--muted);
      margin-top: 4px;
      max-width: 34rem;
    }

    .weather-basis-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }

    .weather-basis-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-strong);
      padding: 18px;
    }

    .weather-basis-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .weather-basis-head h4 {
      margin: 4px 0 0;
      font-size: 1.1rem;
    }

    .decision-copy {
      margin: 0 0 14px;
      font-weight: 700;
    }

    .weather-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin: 0;
    }

    .weather-metrics div,
    .rule-context span {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: var(--surface-soft);
    }

    .weather-metrics dt {
      color: var(--muted);
      font-size: 0.86rem;
    }

    .weather-metrics dd {
      margin: 2px 0 0;
      font-weight: 700;
    }

    .rule-context {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 0.92rem;
    }

    .decision-details {
      margin: 14px 0 0;
      padding-left: 18px;
      color: var(--muted);
    }

    @media (max-width: 720px) {
      .weather-basis-grid,
      .weather-metrics {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class PlanningComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reload$ = new BehaviorSubject<void>(void 0);
  readonly activeTab = signal<'runs' | 'weather'>('runs');

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

  adaptiveItems(items: IrrigationProjectionItem[]): IrrigationProjectionItem[] {
    return items.filter((item) => item.source === 'adaptive_rule');
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

  userReason(item: IrrigationProjectionItem): string {
    if (item.source === 'manual_rule') {
      return item.adjusted_for_sequence
        ? 'Manuelle Regel, nach vorherigem Lauf einsortiert.'
        : 'Manuell angelegte Regel.';
    }
    if (item.status !== 'planned') {
      return item.decision_summary ?? 'Automatische Regel setzt diesen Lauf aus.';
    }
    return `KI-Regel plant ${item.duration_minutes} Minuten im passenden Zeitfenster.`;
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

  numberValue(basis: Record<string, unknown>, key: string, unit: string): string {
    const value = basis[key];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 'unbekannt';
    }
    const formatted = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value);
    return unit === '×' ? `${formatted}×` : `${formatted} ${unit}`;
  }

  boolValue(basis: Record<string, unknown>, key: string): boolean {
    return basis[key] === true;
  }

  windowLabels(basis: Record<string, unknown>): string {
    const windows = Array.isArray(basis['preferred_time_windows']) ? basis['preferred_time_windows'] : [];
    if (!windows.length) {
      return 'unbekannt';
    }
    return windows.map((item) => this.windowLabel(String(item))).join(', ');
  }

  windowLabel(value: string): string {
    const labels: Record<string, string> = {
      early_morning: 'Früher Morgen',
      morning: 'Vormittag',
      evening: 'Abend',
      morning_and_evening: 'Morgen und Abend',
    };
    return labels[value] ?? value;
  }

  basisSourceLabel(basis: Record<string, unknown>): string {
    const status = String(basis['source_status'] ?? '');
    if (status === 'fresh') {
      return 'aktuell';
    }
    if (status === 'stale') {
      return 'älterer Cache';
    }
    return 'nicht verfügbar';
  }
}
