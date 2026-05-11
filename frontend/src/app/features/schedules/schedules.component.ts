import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, map, startWith, Subject, switchMap } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Schedule, Zone } from '../../core/api.models';

type PlanType = 'fixed' | 'interval';
type ScheduleStatusFilter = 'all' | 'active' | 'paused';
type ScheduleTypeFilter = 'all' | 'fixed' | 'interval';

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
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <section class="page-title">
      <h2>Zeitpläne</h2>
      <p>Lege feste Zeiten oder wiederkehrende Bewässerungen im Tagesfenster an.</p>
    </section>

    <section class="panel" *ngIf="!showForm()">
      <div class="toolbar">
        <button class="button" type="button" (click)="openCreateForm()">Zeitplan anlegen</button>
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

        <label class="field field-span-3">
          <span>Bei Regen Lauf überspringen ab (%)</span>
          <input type="number" formControlName="weather_probability_threshold" />
        </label>

        <label class="field field-span-3">
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
        <p class="muted" *ngIf="filteredSchedules(vm.schedules).length === 0">Für den aktuellen Filter wurden keine Zeitpläne gefunden.</p>
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
  private readonly reload$ = new Subject<void>();

  readonly weekdays = WEEKDAYS;
  readonly selectedWeekdays = signal<string[]>(['mon', 'wed', 'fri']);
  readonly planType = signal<PlanType>('fixed');
  readonly showForm = signal(false);
  readonly zoneFilterControl = this.fb.control('');
  readonly zoneFilter = signal<number | null>(null);
  readonly statusFilter = signal<ScheduleStatusFilter>('all');
  readonly typeFilter = signal<ScheduleTypeFilter>('all');
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

  remove(id: number): void {
    this.api.deleteSchedule(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.reload$.next());
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
}
