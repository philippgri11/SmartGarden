import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, map, startWith, Subject, switchMap } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Schedule, Zone } from '../../core/api.models';
import { TIME_WINDOW_LABELS } from '../../core/zone-profile.utils';
import { UiPreferencesService } from '../../core/ui-preferences.service';
import { ExpertSectionComponent } from '../../shared/expert-section.component';

type PlanType = 'fixed' | 'interval';
type ScheduleStatusFilter = 'all' | 'active' | 'paused';
type ScheduleTypeFilter = 'all' | 'fixed' | 'interval' | 'adaptive';
type ScenarioField =
  | 'days'
  | 'temperatureMaxC'
  | 'rainLast24hMm'
  | 'rainNext24hMm'
  | 'cloudCoverPct'
  | 'lastRunHoursAgo'
  | 'alreadyWateredToday';

interface AdaptiveScenario {
  days: number;
  temperatureMaxC: number;
  rainLast24hMm: number;
  rainNext24hMm: number;
  cloudCoverPct: number;
  lastRunHoursAgo: number;
  alreadyWateredToday: boolean;
}

interface AdaptiveScenarioRow {
  dayLabel: string;
  windowLabel: string;
  timeLabel: string;
  decision: string;
  duration: string;
  reason: string;
}

const WEEKDAYS = [
  { id: 'mon', label: 'Mo' },
  { id: 'tue', label: 'Di' },
  { id: 'wed', label: 'Mi' },
  { id: 'thu', label: 'Do' },
  { id: 'fri', label: 'Fr' },
  { id: 'sat', label: 'Sa' },
  { id: 'sun', label: 'So' },
];

@Component({
  standalone: true,
  selector: 'app-schedules',
  imports: [CommonModule, ReactiveFormsModule, ExpertSectionComponent],
  template: `
    <section class="page-title">
      <h2>Zeitpläne</h2>
      <p>Lege feste Zeiten an oder prüfe adaptive KI-Regelpläne für Bereiche.</p>
    </section>

    <section class="panel compact-action-panel" *ngIf="!showForm()">
      <div class="toolbar">
        <button class="button button-subtle" type="button" (click)="openCreateForm()">Zeitplan anlegen</button>
      </div>
    </section>

    <ng-container *ngIf="vm$ | async as vm">
      <section class="panel">
        <div class="section-head">
          <div>
            <h3>Filter</h3>
            <p class="muted">Zeige nur die Zeitpläne, die gerade für dich wichtig sind.</p>
          </div>
          <button class="button secondary" type="button" (click)="clearFilters()">Filter zurücksetzen</button>
        </div>

        <div class="form-grid form-grid-balanced schedules-filter-grid">
          <label class="field field-span-4">
            <span>Bereich</span>
            <select [formControl]="zoneFilterControl">
              <option value="">Alle Bereiche</option>
              <option *ngFor="let zone of vm.zones" [value]="zone.id.toString()">{{ zone.name }}</option>
            </select>
          </label>
          <label class="field field-span-4">
            <span>Status</span>
            <select [value]="statusFilter()" (change)="statusFilter.set($any($event.target).value)">
              <option value="all">Alle</option>
              <option value="active">Aktive</option>
              <option value="paused">Pausierte</option>
            </select>
          </label>
          <label class="field field-span-4">
            <span>Plan-Typ</span>
            <select [value]="typeFilter()" (change)="typeFilter.set($any($event.target).value)">
              <option value="all">Alle</option>
              <option value="fixed">Feste Uhrzeit</option>
              <option value="interval">Wiederholen im Zeitraum</option>
              <option value="adaptive">KI-adaptiv</option>
            </select>
          </label>
        </div>
      </section>

      <section #scheduleFormPanel class="panel" *ngIf="showForm()">
        <div class="section-head">
          <div>
            <h3>{{ selectedSchedule ? 'Zeitplan bearbeiten' : 'Zeitplan anlegen' }}</h3>
            <p class="muted">Lege einen neuen Plan an oder passe einen bestehenden Plan an.</p>
          </div>
          <button class="button secondary" type="button" (click)="reset(vm.zones)">Schließen</button>
        </div>
        <form [formGroup]="form" class="form-grid form-grid-balanced schedules-form-grid" (ngSubmit)="save()">
        <label class="field field-span-4">
          <span>Bereich</span>
          <select formControlName="zone_id">
            <option *ngFor="let zone of vm.zones" [ngValue]="zone.id">{{ zone.name }}</option>
          </select>
        </label>

        <div class="field field-full">
          <span>Plan-Typ</span>
          <div class="choice-row">
            <button class="choice-pill" [class.active]="planType() === 'fixed'" type="button" (click)="planType.set('fixed')">Feste Uhrzeit</button>
            <button class="choice-pill" [class.active]="planType() === 'interval'" type="button" (click)="planType.set('interval')">Wiederholen im Zeitraum</button>
          </div>
        </div>

        <div class="field field-full">
          <span>Wochentage</span>
          <div class="weekday-grid">
            <button
              *ngFor="let day of weekdays"
              type="button"
              class="choice-pill"
              [class.active]="selectedWeekdays().includes(day.id)"
              (click)="toggleWeekday(day.id)"
            >
              {{ day.label }}
            </button>
          </div>
        </div>

        <ng-container *ngIf="planType() === 'fixed'; else intervalFields">
          <label class="field field-span-3">
            <span>Startzeit</span>
            <input type="time" formControlName="start_time" />
          </label>
          <label class="field field-span-3">
            <span>Dauer in Minuten</span>
            <input type="number" formControlName="duration_minutes" />
          </label>
        </ng-container>

        <ng-template #intervalFields>
          <label class="field field-span-3">
            <span>Fenster Start</span>
            <input type="time" formControlName="window_start" />
          </label>
          <label class="field field-span-3">
            <span>Fenster Ende</span>
            <input type="time" formControlName="window_end" />
          </label>
          <label class="field field-span-3">
            <span>Intervall in Stunden</span>
            <input type="number" formControlName="interval_hours" />
          </label>
          <label class="field field-span-3">
            <span>Dauer je Lauf</span>
            <input type="number" formControlName="duration_minutes" />
          </label>
        </ng-template>

        <label class="field field-span-3">
          <span>Plan aktiv</span>
          <select formControlName="active">
            <option [ngValue]="true">Ja</option>
            <option [ngValue]="false">Nein</option>
          </select>
        </label>

        <label class="field field-span-3">
          <span>Wetter berücksichtigen</span>
          <select formControlName="weather_enabled">
            <option [ngValue]="true">Ja</option>
            <option [ngValue]="false">Nein</option>
          </select>
        </label>

        <p class="muted field-span-6" *ngIf="!form.controls.weather_enabled.value">
          Dieser feste Plan läuft unabhängig vom Wetter. Regen-Grenzen erscheinen erst, wenn du Wetter berücksichtigst.
        </p>

        <label class="field field-span-3" *ngIf="form.controls.weather_enabled.value">
          <span>Bei Regen Lauf überspringen ab (%)</span>
          <input type="number" formControlName="weather_probability_threshold" />
        </label>

        <label class="field field-span-3" *ngIf="form.controls.weather_enabled.value">
          <span>Bei Regenmenge Lauf überspringen ab (mm)</span>
          <input type="number" formControlName="weather_precipitation_mm_threshold" />
        </label>

        <div class="schedule-preview field-full">
          <strong>Vorschau</strong>
          <p>{{ preview(vm.zones) }}</p>
        </div>

        <div class="toolbar field-full">
          <button class="button" type="submit">{{ selectedSchedule ? 'Zeitplan speichern' : 'Zeitplan anlegen' }}</button>
          <button class="button secondary" type="button" (click)="reset(vm.zones)">Zurücksetzen</button>
        </div>
        </form>
      </section>

      <section class="panel">
        <h3>Bestehende Zeitpläne</h3>
        <div class="schedule-list">
          <article class="schedule-card" *ngFor="let zone of filteredAdaptiveZones(vm.zones)">
            <div class="schedule-card-head schedule-card-head-rich">
              <div class="schedule-card-title">
                <div class="eyebrow">Bereich</div>
                <h4>{{ zone.name }}</h4>
                <p class="schedule-card-summary">{{ adaptiveSummary(zone) }}</p>
              </div>
              <div class="schedule-card-badges">
                <span class="status-chip" [class.status-paused]="!zone.active">{{ zone.active ? 'Aktiv' : 'Pausiert' }}</span>
                <span class="schedule-type-chip">KI-adaptiv</span>
              </div>
            </div>

            <div class="schedule-chip-row">
              <span class="schedule-weekday-chip" *ngFor="let window of adaptiveWindows(zone)">{{ window }}</span>
            </div>

            <div class="schedule-meta-grid">
              <div class="schedule-meta-item" title="Der Scheduler prüft nur diese Zeitfenster. Ob ein Lauf entsteht, entscheidet die Wetter- und Zonenformel.">
                <span>Zeitfenster</span>
                <strong>{{ adaptiveWindowText(zone) }}</strong>
              </div>
              <div class="schedule-meta-item" title="Aus der Basisdauer wird die tatsächliche Laufzeit berechnet: Hitze, Sonne und Austrocknung erhöhen, wirksamer Regen reduziert.">
                <span>Adaptive Laufzeit</span>
                <strong>{{ adaptiveDurationText(zone) }}</strong>
              </div>
              <div class="schedule-meta-item" title="Der Mindestabstand verhindert, dass der adaptive Modus zu häufig automatisch startet. Manuelle Läufe bleiben davon unberührt.">
                <span>Mindestabstand</span>
                <strong>{{ zone.adaptive_irrigation_plan?.minIntervalHours ?? 0 }} Std.</strong>
              </div>
            </div>

            <p class="schedule-note">{{ adaptiveWeatherNote(zone) }}</p>
            <ul class="schedule-rule-list" *ngIf="zone.adaptive_irrigation_plan?.rules?.length">
              <li *ngFor="let rule of zone.adaptive_irrigation_plan?.rules">{{ rule }}</li>
            </ul>

            <app-expert-section [enabled]="expertMode()" title="Technische Regel und Szenario-Rechner">
              <div class="technical-rule">
                <strong>Konkrete Regel</strong>
                <pre>{{ technicalRule(zone) }}</pre>
              </div>

              <div class="form-grid form-grid-balanced scenario-grid">
                <label class="field field-span-2" title="Anzahl der Tage, die mit denselben Wetterannahmen simuliert werden. Die Tabelle berücksichtigt dabei bereits geplante Läufe der vorherigen Zeilen.">
                  <span>Tage berechnen</span>
                  <input type="number" min="1" max="14" [value]="scenarioValue(zone.id, 'days')" (input)="updateScenario(zone.id, 'days', $any($event.target).value)" />
                </label>
                <label class="field field-span-2" title="Tageshöchsttemperatur im Beispiel. Höhere Werte erhöhen den Bedarf abhängig von der Hitzereaktion der Zone.">
                  <span>Tageshöchsttemperatur °C</span>
                  <input type="number" [value]="scenarioValue(zone.id, 'temperatureMaxC')" (input)="updateScenario(zone.id, 'temperatureMaxC', $any($event.target).value)" />
                </label>
                <label class="field field-span-2" title="Regen der letzten 24 Stunden. Er reduziert den Bedarf nur nach Regenwirksamkeit der Zone.">
                  <span>Regen letzte 24h mm</span>
                  <input type="number" min="0" step="0.1" [value]="scenarioValue(zone.id, 'rainLast24hMm')" (input)="updateScenario(zone.id, 'rainLast24hMm', $any($event.target).value)" />
                </label>
                <label class="field field-span-2" title="Regenprognose der nächsten 24 Stunden. Sie zählt halb in die Regenanrechnung und kann Läufe verschieben.">
                  <span>Regen nächste 24h mm</span>
                  <input type="number" min="0" step="0.1" [value]="scenarioValue(zone.id, 'rainNext24hMm')" (input)="updateScenario(zone.id, 'rainNext24hMm', $any($event.target).value)" />
                </label>
                <label class="field field-span-2" title="Bewölkung im Beispiel. Wenig Bewölkung erhöht den Sonnenfaktor abhängig von der Sonnenreaktion.">
                  <span>Bewölkung %</span>
                  <input type="number" min="0" max="100" [value]="scenarioValue(zone.id, 'cloudCoverPct')" (input)="updateScenario(zone.id, 'cloudCoverPct', $any($event.target).value)" />
                </label>
                <label class="field field-span-2" title="Stunden seit dem letzten adaptiven Lauf. Unterhalb des Mindestabstands wird nicht automatisch gegossen.">
                  <span>Letzter Lauf vor Std.</span>
                  <input type="number" min="0" [value]="scenarioValue(zone.id, 'lastRunHoursAgo')" (input)="updateScenario(zone.id, 'lastRunHoursAgo', $any($event.target).value)" />
                </label>
                <label class="field field-span-2" title="Wenn heute schon automatisch gegossen wurde und kein zweiter Lauf erlaubt ist, bleibt der nächste Lauf aus.">
                  <span>Heute schon gegossen</span>
                  <select [value]="scenarioValue(zone.id, 'alreadyWateredToday')" (change)="updateScenario(zone.id, 'alreadyWateredToday', $any($event.target).value)">
                    <option [value]="false">Nein</option>
                    <option [value]="true">Ja</option>
                  </select>
                </label>
              </div>

              <div class="scenario-table-wrap">
                <table class="scenario-table">
                  <thead>
                    <tr>
                      <th>Tag</th>
                      <th>Fenster</th>
                      <th>Zeit</th>
                      <th>Entscheidung</th>
                      <th>Dauer</th>
                      <th>Warum</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of adaptiveScenarioRows(zone)">
                      <td>{{ row.dayLabel }}</td>
                      <td>{{ row.windowLabel }}</td>
                      <td>{{ row.timeLabel }}</td>
                      <td>{{ row.decision }}</td>
                      <td>{{ row.duration }}</td>
                      <td>{{ row.reason }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </app-expert-section>

            <div class="toolbar schedule-card-actions">
              <button class="button secondary" type="button" (click)="openAdaptiveZone(zone.id)">Regeln bearbeiten</button>
            </div>
          </article>

          <article class="schedule-card" *ngFor="let schedule of filteredSchedules(vm.schedules)">
            <div class="schedule-card-head schedule-card-head-rich">
              <div class="schedule-card-title">
                <div class="eyebrow">Bereich</div>
                <h4>{{ zoneName(vm.zones, schedule.zone_id) }}</h4>
                <p class="schedule-card-summary">{{ scheduleSummary(schedule) }}</p>
              </div>
              <div class="schedule-card-badges">
                <span class="status-chip" [class.status-paused]="!schedule.active">{{ schedule.active ? 'Aktiv' : 'Pausiert' }}</span>
                <span class="schedule-type-chip">{{ scheduleTypeLabel(schedule) }}</span>
              </div>
            </div>

            <div class="schedule-chip-row">
              <span class="schedule-weekday-chip" *ngFor="let weekday of schedule.weekdays">{{ weekdayLabel(weekday) }}</span>
            </div>

            <div class="schedule-meta-grid">
              <div class="schedule-meta-item">
                <span>{{ schedule.interval_hours ? 'Zeitfenster' : 'Start' }}</span>
                <strong>{{ primaryTimeLabel(schedule) }}</strong>
              </div>
              <div class="schedule-meta-item">
                <span>{{ schedule.interval_hours ? 'Intervall' : 'Dauer' }}</span>
                <strong>{{ cadenceLabel(schedule) }}</strong>
              </div>
              <div class="schedule-meta-item">
                <span>Wetter</span>
                <strong>{{ weatherLabel(schedule) }}</strong>
              </div>
            </div>

            <p class="schedule-note">{{ weatherNote(schedule) }}</p>

            <div class="toolbar schedule-card-actions">
              <button class="button secondary" type="button" (click)="edit(schedule)">Bearbeiten</button>
              <button class="button danger" type="button" (click)="remove(schedule.id)">Löschen</button>
            </div>
          </article>
        </div>
        <p class="muted" *ngIf="filteredSchedules(vm.schedules).length + filteredAdaptiveZones(vm.zones).length === 0">Für den aktuellen Filter wurden keine Zeitpläne gefunden.</p>
      </section>
    </ng-container>
  `,
})
export class SchedulesComponent {
  @ViewChild('scheduleFormPanel')
  private scheduleFormPanel?: ElementRef<HTMLElement>;

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly preferences = inject(UiPreferencesService);
  private readonly reload$ = new Subject<void>();

  readonly weekdays = WEEKDAYS;
  readonly selectedWeekdays = signal<string[]>(['mon', 'wed', 'fri']);
  readonly planType = signal<PlanType>('fixed');
  readonly showForm = signal(false);
  readonly zoneFilterControl = this.fb.control('');
  readonly zoneFilter = signal<number | null>(null);
  readonly statusFilter = signal<ScheduleStatusFilter>('all');
  readonly typeFilter = signal<ScheduleTypeFilter>('all');
  readonly expertMode = computed(() => this.preferences.expertMode());
  readonly scenarioByZone = signal<Record<number, AdaptiveScenario>>({});
  selectedSchedule: Schedule | null = null;
  private latestZones: Zone[] = [];

  readonly vm$ = this.reload$.pipe(
    startWith(void 0),
    switchMap(() =>
      combineLatest([this.api.getZones(), this.api.getSchedules()]).pipe(
        map(([zones, schedules]) => {
          this.latestZones = zones;
          const routeZoneIdParam = this.route.snapshot.queryParamMap.get('zoneId');
          const routeZoneId = routeZoneIdParam ? Number(routeZoneIdParam) : null;
          if (Number.isFinite(routeZoneId) && this.zoneFilter() !== routeZoneId) {
            this.zoneFilter.set(routeZoneId as number);
            this.zoneFilterControl.setValue(routeZoneIdParam ?? '', { emitEvent: false });
            if (!this.selectedSchedule) {
              this.form.patchValue({ zone_id: routeZoneId as number }, { emitEvent: false });
            }
          }
          return { zones, schedules };
        })
      )
    )
  );

  readonly form = this.fb.nonNullable.group({
    zone_id: [1, Validators.required],
    start_time: ['06:00', Validators.required],
    duration_minutes: [5, Validators.required],
    interval_hours: [null as number | null],
    window_start: ['06:00'],
    window_end: ['18:00'],
    active: [true, Validators.required],
    weather_enabled: [false, Validators.required],
    weather_probability_threshold: [70],
    weather_precipitation_mm_threshold: [2],
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const zoneIdParam = params.get('zoneId');
      const zoneId = zoneIdParam ? Number(zoneIdParam) : null;
      this.zoneFilter.set(Number.isFinite(zoneId) ? zoneId : null);
      this.zoneFilterControl.setValue(zoneIdParam ?? '', { emitEvent: false });
      if (Number.isFinite(zoneId)) {
        this.form.patchValue({ zone_id: zoneId as number }, { emitEvent: false });
      }
    });

    this.zoneFilterControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.setZoneFilter(value ?? '');
    });
  }

  toggleWeekday(dayId: string): void {
    const current = this.selectedWeekdays();
    this.selectedWeekdays.set(
      current.includes(dayId) ? current.filter((item) => item !== dayId) : [...current, dayId]
    );
  }

  save(): void {
    const raw = this.form.getRawValue();
    const payload = {
      zone_id: raw.zone_id,
      weekdays: this.selectedWeekdays(),
      start_time: this.planType() === 'fixed' ? raw.start_time : raw.window_start,
      duration_minutes: raw.duration_minutes,
      interval_hours: this.planType() === 'interval' ? raw.interval_hours : null,
      window_start: this.planType() === 'interval' ? raw.window_start : null,
      window_end: this.planType() === 'interval' ? raw.window_end : null,
      active: raw.active,
      weather_enabled: raw.weather_enabled,
      weather_probability_threshold: raw.weather_probability_threshold,
      weather_precipitation_mm_threshold: raw.weather_precipitation_mm_threshold,
    };
    const request$ = this.selectedSchedule
      ? this.api.updateSchedule(this.selectedSchedule.id, payload)
      : this.api.createSchedule(payload);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.reload$.next();
      this.reset(this.latestZones);
    });
  }

  openCreateForm(): void {
    this.reset(this.latestZones);
    if (this.zoneFilter() !== null) {
      this.form.patchValue({ zone_id: this.zoneFilter()! }, { emitEvent: false });
    }
    this.showForm.set(true);
    requestAnimationFrame(() => {
      this.scheduleFormPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  edit(schedule: Schedule): void {
    this.selectedSchedule = schedule;
    this.showForm.set(true);
    this.selectedWeekdays.set(schedule.weekdays);
    this.planType.set(schedule.interval_hours ? 'interval' : 'fixed');
    this.form.patchValue({
      zone_id: schedule.zone_id,
      start_time: schedule.start_time,
      duration_minutes: schedule.duration_minutes,
      interval_hours: schedule.interval_hours ?? null,
      window_start: schedule.window_start ?? '06:00',
      window_end: schedule.window_end ?? '18:00',
      active: schedule.active,
      weather_enabled: schedule.weather_enabled,
      weather_probability_threshold: schedule.weather_probability_threshold ?? 70,
      weather_precipitation_mm_threshold: schedule.weather_precipitation_mm_threshold ?? 2,
    });
    requestAnimationFrame(() => {
      this.scheduleFormPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  reset(zones: Zone[]): void {
    this.selectedSchedule = null;
    this.selectedWeekdays.set(['mon', 'wed', 'fri']);
    this.planType.set('fixed');
    this.form.reset({
      zone_id: this.zoneFilter() ?? zones[0]?.id ?? 1,
      start_time: '06:00',
      duration_minutes: 5,
      interval_hours: null,
      window_start: '06:00',
      window_end: '18:00',
      active: true,
      weather_enabled: false,
      weather_probability_threshold: 70,
      weather_precipitation_mm_threshold: 2,
    });
    this.showForm.set(false);
  }

  setZoneFilter(rawValue: string): void {
    const zoneId = rawValue ? Number(rawValue) : null;
    this.zoneFilter.set(Number.isFinite(zoneId) ? zoneId : null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.zoneFilter() ? { zoneId: this.zoneFilter() } : { zoneId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  clearFilters(): void {
    this.zoneFilter.set(null);
    this.zoneFilterControl.setValue('', { emitEvent: false });
    this.statusFilter.set('all');
    this.typeFilter.set('all');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { zoneId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  filteredSchedules(schedules: Schedule[]): Schedule[] {
    if (this.typeFilter() === 'adaptive') {
      return [];
    }
    return schedules.filter((schedule) => {
      if (this.zoneFilter() !== null && schedule.zone_id !== this.zoneFilter()) {
        return false;
      }
      if (this.statusFilter() === 'active' && !schedule.active) {
        return false;
      }
      if (this.statusFilter() === 'paused' && schedule.active) {
        return false;
      }
      if (this.typeFilter() === 'fixed' && !!schedule.interval_hours) {
        return false;
      }
      if (this.typeFilter() === 'interval' && !schedule.interval_hours) {
        return false;
      }
      return true;
    });
  }

  filteredAdaptiveZones(zones: Zone[]): Zone[] {
    if (this.typeFilter() === 'fixed' || this.typeFilter() === 'interval') {
      return [];
    }
    return zones.filter((zone) => {
      if (zone.scheduling_mode !== 'adaptive' || !zone.adaptive_irrigation_plan) {
        return false;
      }
      if (this.zoneFilter() !== null && zone.id !== this.zoneFilter()) {
        return false;
      }
      if (this.statusFilter() === 'active' && !zone.active) {
        return false;
      }
      if (this.statusFilter() === 'paused' && zone.active) {
        return false;
      }
      return true;
    });
  }

  remove(id: number): void {
    this.api.deleteSchedule(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.reload$.next());
  }

  openAdaptiveZone(zoneId: number): void {
    void this.router.navigate(['/areas'], { queryParams: { zoneId } });
  }

  zoneName(zones: Zone[], zoneId: number): string {
    return zones.find((zone) => zone.id === zoneId)?.name ?? `Bereich ${zoneId}`;
  }

  preview(zones: Zone[]): string {
    const raw = this.form.getRawValue();
    const zone = this.zoneName(zones, raw.zone_id);
    const weekdayText = this.selectedWeekdays().map((weekday) => WEEKDAYS.find((item) => item.id === weekday)?.label).join(', ');
    const durationText = `${raw.duration_minutes} ${raw.duration_minutes === 1 ? 'Minute' : 'Minuten'}`;
    const weatherText = raw.weather_enabled
      ? `Bei Regenwahrscheinlichkeit über ${raw.weather_probability_threshold} % wird übersprungen.`
      : 'Wetter wird nicht berücksichtigt.';
    if (this.planType() === 'interval') {
      return `${zone} bewässert ${weekdayText} zwischen ${raw.window_start} und ${raw.window_end} alle ${raw.interval_hours || 1} Stunden für ${durationText}. ${weatherText}`;
    }
    return `${zone} bewässert ${weekdayText} um ${raw.start_time} Uhr für ${durationText}. ${weatherText}`;
  }

  scheduleText(schedule: Schedule): string {
    if (schedule.interval_hours && schedule.window_start && schedule.window_end) {
      return `${schedule.weekdays.join(', ')} · ${schedule.window_start}–${schedule.window_end} · alle ${schedule.interval_hours}h · ${schedule.duration_minutes} min`;
    }
    return `${schedule.weekdays.join(', ')} · ${schedule.start_time} · ${schedule.duration_minutes} min`;
  }

  weekdayLabel(weekdayId: string): string {
    return WEEKDAYS.find((item) => item.id === weekdayId)?.label ?? weekdayId;
  }

  weekdayLongLabel(weekdayId: string): string {
    const mapping: Record<string, string> = {
      mon: 'Montag',
      tue: 'Dienstag',
      wed: 'Mittwoch',
      thu: 'Donnerstag',
      fri: 'Freitag',
      sat: 'Samstag',
      sun: 'Sonntag',
    };
    return mapping[weekdayId] ?? weekdayId;
  }

  weekdayText(weekdayIds: string[]): string {
    const labels = weekdayIds.map((weekdayId) => this.weekdayLongLabel(weekdayId));
    if (labels.length <= 1) {
      return labels[0] ?? '';
    }
    if (labels.length === 2) {
      return `${labels[0]} und ${labels[1]}`;
    }
    return `${labels.slice(0, -1).join(', ')} und ${labels.at(-1)}`;
  }

  scheduleTypeLabel(schedule: Schedule): string {
    return schedule.interval_hours ? 'Wiederholung' : 'Feste Uhrzeit';
  }

  formatTime(value: string | null | undefined): string {
    if (!value) {
      return 'Nicht festgelegt';
    }
    return value.slice(0, 5);
  }

  durationLabel(minutes: number): string {
    return `${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
  }

  primaryTimeLabel(schedule: Schedule): string {
    if (schedule.interval_hours && schedule.window_start && schedule.window_end) {
      return `${this.formatTime(schedule.window_start)} bis ${this.formatTime(schedule.window_end)} Uhr`;
    }
    return `${this.formatTime(schedule.start_time)} Uhr`;
  }

  cadenceLabel(schedule: Schedule): string {
    if (schedule.interval_hours) {
      return `alle ${schedule.interval_hours} Std., je ${this.durationLabel(schedule.duration_minutes)}`;
    }
    return this.durationLabel(schedule.duration_minutes);
  }

  weatherLabel(schedule: Schedule): string {
    return schedule.weather_enabled ? 'Wird berücksichtigt' : 'Nicht aktiv';
  }

  weatherNote(schedule: Schedule): string {
    if (!schedule.weather_enabled) {
      return 'Dieser Plan läuft unabhängig von der Wettersteuerung.';
    }
    return `Bei Regenwahrscheinlichkeit ab ${schedule.weather_probability_threshold ?? 70} % oder Regenmenge ab ${schedule.weather_precipitation_mm_threshold ?? 2} mm wird der Lauf übersprungen.`;
  }

  scheduleSummary(schedule: Schedule): string {
    const weekdays = this.weekdayText(schedule.weekdays);
    if (schedule.interval_hours && schedule.window_start && schedule.window_end) {
      return `${weekdays} zwischen ${this.formatTime(schedule.window_start)} und ${this.formatTime(schedule.window_end)} Uhr, alle ${schedule.interval_hours} Stunden.`;
    }
    return `${weekdays} um ${this.formatTime(schedule.start_time)} Uhr für ${this.durationLabel(schedule.duration_minutes)}.`;
  }

  adaptiveWindows(zone: Zone): string[] {
    return (zone.adaptive_irrigation_plan?.preferredTimeWindows ?? []).map((window) => TIME_WINDOW_LABELS[window] ?? window);
  }

  adaptiveWindowText(zone: Zone): string {
    const labels = this.adaptiveWindows(zone);
    return labels.length ? labels.join(', ') : 'Noch nicht festgelegt';
  }

  adaptiveDurationText(zone: Zone): string {
    const plan = zone.adaptive_irrigation_plan;
    if (!plan) {
      return 'Noch nicht festgelegt';
    }
    return `${plan.minDurationMinutes}-${plan.maxDurationMinutes} Min., Basis ${plan.baseDurationMinutes} Min.`;
  }

  adaptiveSummary(zone: Zone): string {
    const plan = zone.adaptive_irrigation_plan;
    if (!plan) {
      return 'Adaptive Regeln sind noch nicht vollständig gespeichert.';
    }
    const secondRun = plan.allowSecondDailyRun ? 'zweiter Lauf bei hohem Bedarf möglich' : 'maximal ein automatischer Lauf pro Tag';
    return `Wetterbasierter Regelplan: ${this.adaptiveWindowText(zone)}, ${secondRun}.`;
  }

  adaptiveWeatherNote(zone: Zone): string {
    const plan = zone.adaptive_irrigation_plan;
    if (!plan) {
      return 'Dieser Bereich ist auf adaptiv gestellt, hat aber noch keinen Regelplan.';
    }
    const midday = plan.avoidMidday ? 'Mittag wird vermieden.' : 'Mittag ist fachlich erlaubt, zum Beispiel bei Tröpfchenbewässerung.';
    return `Regen-Skip ab ${plan.rainSkipThresholdMm} mm wirksamem Regen, Verzögerung ab ${plan.rainDelayThresholdMm} mm Prognose. ${midday}`;
  }

  technicalRule(zone: Zone): string {
    const plan = zone.adaptive_irrigation_plan;
    const profile = zone.irrigation_profile;
    if (!plan || !profile) {
      return 'Kein vollständiger adaptiver Regelplan gespeichert.';
    }
    return [
      `Fenster = ${plan.preferredTimeWindows.join(', ')}`,
      `Basisdauer = ${plan.baseDurationMinutes} min, clamp(${plan.minDurationMinutes}, ${Math.min(plan.maxDurationMinutes, zone.max_duration_minutes)})`,
      `Mindestabstand = ${plan.minIntervalHours} h, zweiter Tageslauf = ${plan.allowSecondDailyRun ? 'ja' : 'nein'}`,
      `tempFactor = clamp(1 + clamp((Tmax - 22) / 14, -0.5, 1.0) * 0.35 * ${profile.temperatureSensitivity}, 0.75, 1.7)`,
      `sunFactor = clamp(1 + ((1 - Bewölkung/100) - 0.45) * 0.4 * ${profile.sunSensitivity}, 0.75, 1.5)`,
      `containerFactor = 1 + (${profile.containerFactor} - 1) * 0.25`,
      `estimatedNeed = ${profile.baseWaterNeedMmPerDay} * tempFactor * sunFactor * containerFactor * strategy(${profile.strategy}) * drying(${profile.dryingSpeed})`,
      `effectiveRain = (Regen24h + Prognose24h * 0.5) * ${profile.rainEffectiveness}`,
      `netNeed = max(0, estimatedNeed - effectiveRain)`,
      `duration = round(${plan.baseDurationMinutes} * clamp(netNeed / ${profile.baseWaterNeedMmPerDay}, 0.35, 1.6))`,
      `skip wenn effectiveRain >= ${plan.rainSkipThresholdMm} mm oder netNeed < 0.6 mm`,
      `delay wenn Prognose24h >= ${plan.rainDelayThresholdMm} mm und netNeed < ${plan.highNeedThresholdMm} mm`,
    ].join('\n');
  }

  scenarioValue(zoneId: number, field: ScenarioField): number | boolean {
    return this.scenarioFor(zoneId)[field];
  }

  updateScenario(zoneId: number, field: ScenarioField, rawValue: string): void {
    this.scenarioByZone.update((current) => {
      const previous = this.scenarioFor(zoneId);
      const rawNumber = Number(rawValue);
      const value = field === 'alreadyWateredToday'
        ? rawValue === 'true'
        : this.clamp(Number.isFinite(rawNumber) ? rawNumber : 0, field === 'days' ? 1 : 0, field === 'days' ? 14 : 999);
      const next: AdaptiveScenario = {
        ...previous,
        [field]: value,
      };
      return { ...current, [zoneId]: next };
    });
  }

  adaptiveScenarioRows(zone: Zone): AdaptiveScenarioRow[] {
    const plan = zone.adaptive_irrigation_plan;
    const profile = zone.irrigation_profile;
    if (!plan || !profile) {
      return [];
    }
    const scenario = this.scenarioFor(zone.id);
    const windows = this.expandAdaptiveWindows(plan.preferredTimeWindows)
      .sort((left, right) => this.adaptiveWindowHour(left) - this.adaptiveWindowHour(right));
    const rows: AdaptiveScenarioRow[] = [];
    let lastRunAbsoluteHour = -Math.max(0, scenario.lastRunHoursAgo);
    const days = Math.max(1, Math.min(Math.round(scenario.days), 14));
    for (let dayIndex = 1; dayIndex <= days; dayIndex += 1) {
      let alreadyWateredToday = dayIndex === 1 && scenario.alreadyWateredToday;
      for (const window of windows) {
        const absoluteHour = (dayIndex - 1) * 24 + this.adaptiveWindowHour(window);
        const rowScenario: AdaptiveScenario = {
          ...scenario,
          lastRunHoursAgo: Math.max(0, Math.round((absoluteHour - lastRunAbsoluteHour) * 10) / 10),
          alreadyWateredToday,
        };
        const row = this.adaptiveScenarioRow(zone, window, rowScenario, dayIndex);
        rows.push(row);
        if (row.decision === 'Bewässern') {
          lastRunAbsoluteHour = absoluteHour;
          alreadyWateredToday = true;
        }
      }
    }
    return rows;
  }

  private scenarioFor(zoneId: number): AdaptiveScenario {
    return this.scenarioByZone()[zoneId] ?? {
      days: 3,
      temperatureMaxC: 30,
      rainLast24hMm: 0,
      rainNext24hMm: 0,
      cloudCoverPct: 20,
      lastRunHoursAgo: 24,
      alreadyWateredToday: false,
    };
  }

  private adaptiveScenarioRow(zone: Zone, window: string, scenario: AdaptiveScenario, dayIndex: number): AdaptiveScenarioRow {
    const plan = zone.adaptive_irrigation_plan!;
    const profile = zone.irrigation_profile!;
    const dayLabel = `Tag ${dayIndex}`;
    const windowLabel = TIME_WINDOW_LABELS[window as keyof typeof TIME_WINDOW_LABELS] ?? window;
    const timeLabel = this.adaptiveWindowStart(window);
    if (scenario.lastRunHoursAgo < plan.minIntervalHours) {
      return {
        dayLabel,
        windowLabel,
        timeLabel,
        decision: 'Kein Lauf',
        duration: '0 min',
        reason: `Mindestabstand ${plan.minIntervalHours} h, im Beispiel erst ${scenario.lastRunHoursAgo} h seit dem letzten Lauf.`,
      };
    }
    if (scenario.alreadyWateredToday && !plan.allowSecondDailyRun) {
      return {
        dayLabel,
        windowLabel,
        timeLabel,
        decision: 'Kein Lauf',
        duration: '0 min',
        reason: 'Heute wurde bereits automatisch gegossen und der Plan erlaubt keinen zweiten Tageslauf.',
      };
    }
    const result = this.calculateAdaptiveNeed(zone, scenario);
    if (result.effectiveRain >= plan.rainSkipThresholdMm && profile.riskProfile !== 'avoid_drought_stress') {
      return {
        dayLabel,
        windowLabel,
        timeLabel,
        decision: 'Überspringen',
        duration: '0 min',
        reason: `Wirksamer Regen ${this.formatNumber(result.effectiveRain)} mm erreicht die Skip-Schwelle ${plan.rainSkipThresholdMm} mm.`,
      };
    }
    if (scenario.rainNext24hMm >= plan.rainDelayThresholdMm && result.netNeed < plan.highNeedThresholdMm) {
      return {
        dayLabel,
        windowLabel,
        timeLabel,
        decision: 'Verschieben',
        duration: '0 min',
        reason: `Regenprognose ${this.formatNumber(scenario.rainNext24hMm)} mm und Netto-Bedarf ${this.formatNumber(result.netNeed)} mm liegt unter ${plan.highNeedThresholdMm} mm.`,
      };
    }
    if (result.netNeed < 0.6 && profile.riskProfile !== 'avoid_drought_stress') {
      return {
        dayLabel,
        windowLabel,
        timeLabel,
        decision: 'Überspringen',
        duration: '0 min',
        reason: `Netto-Bedarf nur ${this.formatNumber(result.netNeed)} mm.`,
      };
    }
    return {
      dayLabel,
      windowLabel,
      timeLabel,
      decision: 'Bewässern',
      duration: `${result.durationMinutes} min`,
      reason: `Netto-Bedarf ${this.formatNumber(result.netNeed)} mm, Faktor ${this.formatNumber(result.multiplier)} auf Basis ${plan.baseDurationMinutes} min.`,
    };
  }

  private calculateAdaptiveNeed(zone: Zone, scenario: AdaptiveScenario): { effectiveRain: number; netNeed: number; multiplier: number; durationMinutes: number } {
    const plan = zone.adaptive_irrigation_plan!;
    const profile = zone.irrigation_profile!;
    const tempPressure = this.clamp((scenario.temperatureMaxC - 22) / 14, -0.5, 1.0);
    const tempFactor = this.clamp(1 + tempPressure * 0.35 * profile.temperatureSensitivity, 0.75, 1.7);
    const sunIndex = this.clamp(1 - scenario.cloudCoverPct / 100, 0, 1);
    const sunFactor = this.clamp(1 + (sunIndex - 0.45) * 0.4 * profile.sunSensitivity, 0.75, 1.5);
    const containerFactor = 1 + (profile.containerFactor - 1) * 0.25;
    const strategyFactor = profile.strategy === 'water_saving' ? 0.9 : profile.strategy === 'growth_oriented' ? 1.08 : 1;
    const dryingFactor = profile.dryingSpeed === 'slow' ? 0.9 : profile.dryingSpeed === 'fast' ? 1.1 : profile.dryingSpeed === 'very_fast' ? 1.2 : 1;
    const estimatedNeed = profile.baseWaterNeedMmPerDay * tempFactor * sunFactor * containerFactor * strategyFactor * dryingFactor;
    const effectiveRain = (scenario.rainLast24hMm + scenario.rainNext24hMm * 0.5) * profile.rainEffectiveness;
    const netNeed = Math.max(0, estimatedNeed - effectiveRain);
    let multiplier = this.clamp(netNeed / Math.max(profile.baseWaterNeedMmPerDay, 0.1), 0.35, 1.6);
    if (profile.riskProfile === 'avoid_drought_stress') {
      multiplier = Math.max(multiplier, 0.6);
    }
    if (profile.riskProfile === 'avoid_overwatering') {
      multiplier = Math.min(multiplier, 1.2);
    }
    const duration = Math.round(plan.baseDurationMinutes * multiplier);
    return {
      effectiveRain,
      netNeed,
      multiplier,
      durationMinutes: Math.max(plan.minDurationMinutes, Math.min(duration, plan.maxDurationMinutes, zone.max_duration_minutes)),
    };
  }

  private expandAdaptiveWindows(windows: string[]): string[] {
    const result: string[] = [];
    for (const window of windows.length ? windows : ['early_morning']) {
      if (window === 'morning_and_evening') {
        result.push('early_morning', 'evening');
      } else {
        result.push(window);
      }
    }
    return Array.from(new Set(result));
  }

  private adaptiveWindowStart(window: string): string {
    const mapping: Record<string, string> = {
      early_morning: '05:30',
      morning: '07:00',
      evening: '19:00',
    };
    return mapping[window] ?? 'nach Regel';
  }

  private adaptiveWindowHour(window: string): number {
    const mapping: Record<string, number> = {
      early_morning: 5.5,
      morning: 7,
      evening: 19,
    };
    return mapping[window] ?? 12;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private formatNumber(value: number): string {
    return value.toFixed(2).replace('.', ',');
  }
}
