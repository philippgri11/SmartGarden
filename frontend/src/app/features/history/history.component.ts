import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { WateringRun, Zone } from '../../core/api.models';
import { UiPreferencesService } from '../../core/ui-preferences.service';
import { AreaStatusBadgeComponent } from '../../shared/area-status-badge.component';
import { ExpertSectionComponent } from '../../shared/expert-section.component';

type FilterId = 'all' | 'completed' | 'skipped' | 'failed' | 'manual' | 'scheduled';

@Component({
  standalone: true,
  selector: 'app-history',
  imports: [CommonModule, DatePipe, AreaStatusBadgeComponent, ExpertSectionComponent],
  template: `
    <section class="page-title">
      <h2>Verlauf</h2>
      <p>Hier siehst du in verständlicher Form, was im Garten passiert ist.</p>
    </section>

    <section class="panel" *ngIf="vm$ | async as vm">
      <h3>Zusammenfassung</h3>
      <div class="card-grid">
        <article class="card"><div class="muted">Bewässerungen diese Woche</div><div class="metric">{{ vm.summary.completedThisWeek }}</div></article>
        <article class="card"><div class="muted">Gesamtminuten diese Woche</div><div class="metric">{{ vm.summary.minutesThisWeek }}</div></article>
        <article class="card"><div class="muted">Übersprungen wegen Wetter</div><div class="metric">{{ vm.summary.weatherSkipped }}</div></article>
        <article class="card"><div class="muted">Fehler</div><div class="metric">{{ vm.summary.failed }}</div></article>
      </div>
    </section>

    <section class="panel" *ngIf="vm$ | async as vm">
      <div class="section-head">
        <div>
          <h3>Ereignisse</h3>
          <p class="muted">Filtere den Verlauf nach Art des Ereignisses.</p>
        </div>
        <div class="choice-row">
          <button *ngFor="let item of filters" class="choice-pill" [class.active]="filter() === item.id" (click)="filter.set(item.id)">
            {{ item.label }}
          </button>
        </div>
      </div>

      <div class="timeline">
        <article class="timeline-item" *ngFor="let run of filteredRuns(vm.runs)">
          <div class="timeline-top">
            <strong>{{ toSentence(run, vm.zones) }}</strong>
            <app-area-status-badge [status]="statusForRun(run)" />
          </div>
          <div class="timeline-meta">
            <span>{{ run.created_at | date: 'short' }}</span>
            <span>Auslöser: {{ run.trigger_type === 'manual' ? 'Manuell' : 'Automatisch' }}</span>
            <span *ngIf="displayReason(run)">Erklärung: {{ displayReason(run) }}</span>
          </div>
          <app-expert-section [enabled]="expertMode()" title="Wetteranalyse" *ngIf="weatherDecisionFor(run) as weatherDecision">
            <div class="weather-analysis-panel">
              <div class="weather-analysis-grid">
                <div><span>Geprüft am</span><strong>{{ weatherDecision.checked_at ? (weatherDecision.checked_at | date: 'short') : 'Unbekannt' }}</strong></div>
                <div><span>Prognose</span><strong>{{ weatherFacts(run) }}</strong></div>
                <div><span>Entscheidung</span><strong>{{ weatherDecision.reason_human || weatherDecision.reason }}</strong></div>
              </div>
            </div>
          </app-expert-section>
        </article>
      </div>
    </section>
  `,
})
export class HistoryComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly preferences = inject(UiPreferencesService);

  readonly filter = signal<FilterId>('all');
  readonly expertMode = computed(() => this.preferences.expertMode());
  readonly filters = [
    { id: 'all' as const, label: 'Alle' },
    { id: 'completed' as const, label: 'Bewässert' },
    { id: 'skipped' as const, label: 'Übersprungen' },
    { id: 'failed' as const, label: 'Fehler' },
    { id: 'manual' as const, label: 'Manuell' },
    { id: 'scheduled' as const, label: 'Automatisch' },
  ];

  readonly vm$ = combineLatest([this.api.getRuns(), this.api.getZones()]).pipe(
    map(([runs, zones]) => ({
      runs,
      zones,
      summary: this.buildSummary(runs),
    })),
    takeUntilDestroyed(this.destroyRef)
  );

  filteredRuns(runs: WateringRun[]): WateringRun[] {
    const selected = this.filter();
    if (selected === 'all') {
      return runs;
    }
    if (selected === 'manual' || selected === 'scheduled') {
      return runs.filter((run) => run.trigger_type === selected);
    }
    return runs.filter((run) => run.status === selected);
  }

  toSentence(run: WateringRun, zones: Zone[]): string {
    const zone = zones.find((item) => item.id === run.zone_id)?.name ?? `Bereich ${run.zone_id}`;
    if (run.status === 'completed') {
      return `${zone} wurde ${run.requested_duration_minutes} ${run.requested_duration_minutes === 1 ? 'Minute' : 'Minuten'} bewässert.`;
    }
    if (run.status === 'skipped') {
      const weatherDecision = this.weatherDecisionFor(run);
      if (run.reason?.includes('Gesamtbewässerung')) {
        return `${zone} wurde einmalig wegen manueller Gesamtbewässerung übersprungen.`;
      }
      if (weatherDecision?.decision === 'skip') {
        return `${zone} wurde wegen erwarteten Regens übersprungen.`;
      }
      if (weatherDecision?.decision === 'error') {
        return `${zone} wurde wegen fehlender Wetterdaten nicht gestartet.`;
      }
      return `${zone} wurde übersprungen.`;
    }
    if (run.status === 'cancelled') {
      return `Bewässerung von ${zone} wurde manuell gestoppt.`;
    }
    if (run.status === 'failed') {
      return `Bei ${zone} ist ein Fehler aufgetreten.`;
    }
    if (run.status === 'running') {
      return `${zone} wird gerade bewässert.`;
    }
    return `Für ${zone} wurde ein Lauf vorbereitet.`;
  }

  statusForRun(run: WateringRun): 'completed' | 'skipped' | 'cancelled' | 'error' | 'watering' | 'active' {
    if (run.status === 'failed') {
      return 'error';
    }
    if (run.status === 'running') {
      return 'watering';
    }
    if (run.status === 'completed') {
      return 'completed';
    }
    if (run.status === 'skipped') {
      return 'skipped';
    }
    if (run.status === 'cancelled') {
      return 'cancelled';
    }
    return 'active';
  }

  private buildSummary(runs: WateringRun[]): { completedThisWeek: number; minutesThisWeek: number; weatherSkipped: number; failed: number } {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeek = runs.filter((run) => new Date(run.created_at).getTime() >= weekAgo);
    return {
      completedThisWeek: thisWeek.filter((run) => run.status === 'completed').length,
      minutesThisWeek: thisWeek
        .filter((run) => run.status === 'completed')
        .reduce((sum, run) => sum + run.requested_duration_minutes, 0),
      weatherSkipped: thisWeek.filter((run) => run.weather_decisions.some((decision) => decision.decision === 'skip')).length,
      failed: thisWeek.filter((run) => run.status === 'failed').length,
    };
  }

  weatherDecisionFor(run: WateringRun) {
    return run.weather_decisions[0] ?? null;
  }

  weatherFacts(run: WateringRun): string {
    const decision = this.weatherDecisionFor(run);
    if (!decision) {
      return 'Keine Wetterdaten';
    }
    const probability =
      decision.precipitation_probability_max === null || decision.precipitation_probability_max === undefined
        ? 'unbekannt'
        : `${Math.round(decision.precipitation_probability_max)} %`;
    const precipitation =
      decision.precipitation_sum_mm === null || decision.precipitation_sum_mm === undefined
        ? 'unbekannt'
        : `${decision.precipitation_sum_mm.toFixed(1).replace('.', ',')} mm`;
    return `${probability} · ${precipitation}`;
  }

  displayReason(run: WateringRun): string | null {
    return this.weatherDecisionFor(run)?.reason_human ?? run.reason ?? null;
  }
}
