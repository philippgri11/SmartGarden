import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { Zone } from '../../core/api.models';
import { UiPreferencesService } from '../../core/ui-preferences.service';
import { AreaCardComponent } from '../../shared/area-card.component';
import { ExpertSectionComponent } from '../../shared/expert-section.component';
import { RuntimeFacade } from '../../state/runtime/runtime.facade';

@Component({
  standalone: true,
  selector: 'app-zones',
  imports: [CommonModule, ReactiveFormsModule, AreaCardComponent, ExpertSectionComponent],
  template: `
    <section class="page-title">
      <h2>Bereiche</h2>
      <p>Hier legst du Bereiche an, passt Standarddauern an und steuerst jeden Bereich direkt.</p>
    </section>

    <section class="panel" *ngIf="!showForm()">
      <div class="toolbar">
        <button class="button" type="button" (click)="openCreateForm()">Bereich anlegen</button>
      </div>
    </section>

    <section #areaFormPanel class="panel" *ngIf="showForm()">
      <div class="section-head">
        <div>
          <h3>{{ selectedArea ? 'Bereich bearbeiten' : 'Neuen Bereich anlegen' }}</h3>
          <p class="muted">Technikdetails erscheinen nur im Expertenmodus.</p>
        </div>
        <button class="button secondary" type="button" (click)="resetForm()">Schließen</button>
      </div>
      <form [formGroup]="form" class="form-grid form-grid-balanced zones-form-grid" (ngSubmit)="saveArea()">
        <label class="field field-span-4">
          <span>Name</span>
          <input formControlName="name" />
        </label>
        <label class="field field-span-2">
          <span>Standarddauer für manuellen Start</span>
          <input type="number" formControlName="default_manual_duration_minutes" />
        </label>
        <label class="field field-span-2">
          <span>Maximale Laufzeit</span>
          <input type="number" formControlName="max_duration_minutes" />
        </label>
        <label class="field field-span-2">
          <span>Aktiv</span>
          <select formControlName="active">
            <option [ngValue]="true">Ja</option>
            <option [ngValue]="false">Nein</option>
          </select>
        </label>
        <label class="field field-span-2">
          <span>Wettersteuerung</span>
          <select formControlName="weather_enabled">
            <option [ngValue]="true">Ja</option>
            <option [ngValue]="false">Nein</option>
          </select>
        </label>
        <label class="field field-full">
          <span>Beschreibung</span>
          <textarea formControlName="description"></textarea>
        </label>

        <app-expert-section [enabled]="expertMode()" title="Hardware und Expertenoptionen">
          <div class="form-grid form-grid-balanced">
            <label class="field field-span-3">
              <span>GPIO-Chip</span>
              <input formControlName="gpio_chip" />
            </label>
            <label class="field field-span-3">
              <span>GPIO-Line</span>
              <input type="number" formControlName="gpio_line" />
            </label>
            <label class="field field-span-3">
              <span>Regenwahrscheinlichkeit ab (%)</span>
              <input type="number" formControlName="weather_probability_threshold" />
            </label>
            <label class="field field-span-3">
              <span>Regenmenge ab (mm)</span>
              <input type="number" formControlName="weather_precipitation_mm_threshold" />
            </label>
          </div>
        </app-expert-section>

        <div class="toolbar field-full">
          <button class="button" type="submit">{{ selectedArea ? 'Bereich speichern' : 'Bereich anlegen' }}</button>
          <button class="button secondary" type="button" (click)="resetForm()">Zurücksetzen</button>
        </div>
      </form>
      <p class="notice success" *ngIf="feedback()">{{ feedback() }}</p>
    </section>

    <section class="panel" *ngIf="vm$ | async as vm">
      <div class="section-head">
        <div>
          <h3>Bereichsübersicht</h3>
          <p class="muted">Alle Bereiche mit Zustand, letzter und nächster Bewässerung.</p>
        </div>
      </div>

      <div class="area-grid">
        <app-area-card
          *ngFor="let area of vm.areas"
          [area]="area"
          [status]="statusForArea(area)"
          [selectedMinutes]="minutesFor(area)"
          [manualDisabled]="manualDisabled(area)"
          [manualDisabledReason]="manualDisabledReason(area)"
          [expertMode]="expertMode()"
          (selectedMinutesChange)="setMinutes(area.id, $event, area.max_duration_minutes)"
          (start)="startArea(area)"
          (stop)="stopArea(area.id)"
          (editSchedule)="openSchedules($event)"
          (editArea)="editArea(area)"
        />
      </div>
    </section>
  `,
})
export class ZonesComponent {
  @ViewChild('areaFormPanel')
  private areaFormPanel?: ElementRef<HTMLElement>;

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly preferences = inject(UiPreferencesService);
  private readonly router = inject(Router);
  private readonly runtime = inject(RuntimeFacade);

  readonly expertMode = computed(() => this.preferences.expertMode());
  readonly feedback = signal('');
  readonly minutes = signal<Record<number, number>>({});
  readonly showForm = signal(false);
  selectedArea: Zone | null = null;

  readonly vm$ = this.runtime.vm$;

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    description: [''],
    gpio_chip: ['/dev/gpiochip0', Validators.required],
    gpio_line: [0, Validators.required],
    active: [true, Validators.required],
    default_manual_duration_minutes: [5, Validators.required],
    max_duration_minutes: [10, Validators.required],
    weather_enabled: [false, Validators.required],
    weather_probability_threshold: [70],
    weather_precipitation_mm_threshold: [2],
  });

  saveArea(): void {
    const payload = this.form.getRawValue();
    const request$ = this.selectedArea
      ? this.api.updateZone(this.selectedArea.id, payload)
      : this.api.createZone(payload);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.feedback.set(this.selectedArea ? 'Bereich gespeichert.' : 'Bereich angelegt.');
      this.resetForm();
      this.runtime.load('areas-form-saved');
    });
  }

  openCreateForm(): void {
    this.selectedArea = null;
    this.showForm.set(true);
    this.resetFormState(false);
    requestAnimationFrame(() => {
      this.areaFormPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  editArea(area: Zone): void {
    this.selectedArea = area;
    this.showForm.set(true);
    this.form.patchValue({
      name: area.name,
      description: area.description ?? '',
      gpio_chip: area.gpio_chip,
      gpio_line: area.gpio_line,
      active: area.active,
      default_manual_duration_minutes: area.default_manual_duration_minutes,
      max_duration_minutes: area.max_duration_minutes,
      weather_enabled: area.weather_enabled,
      weather_probability_threshold: area.weather_probability_threshold ?? 70,
      weather_precipitation_mm_threshold: area.weather_precipitation_mm_threshold ?? 2,
    });
    requestAnimationFrame(() => {
      this.areaFormPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  resetForm(): void {
    this.resetFormState(true);
  }

  private resetFormState(closeForm: boolean): void {
    this.selectedArea = null;
    this.form.reset({
      name: '',
      description: '',
      gpio_chip: '/dev/gpiochip0',
      gpio_line: 0,
      active: true,
      default_manual_duration_minutes: 5,
      max_duration_minutes: 10,
      weather_enabled: false,
      weather_probability_threshold: 70,
      weather_precipitation_mm_threshold: 2,
    });
    if (closeForm) {
      this.showForm.set(false);
    }
  }

  minutesFor(area: Zone): number {
    return this.minutes()[area.id] ?? area.default_manual_duration_minutes;
  }

  setMinutes(areaId: number, value: number, maxMinutes: number): void {
    this.minutes.update((state) => ({
      ...state,
      [areaId]: Math.max(1, Math.min(value, maxMinutes)),
    }));
  }

  startArea(area: Zone): void {
    this.feedback.set(`${area.name} wird gestartet.`);
    this.runtime.startArea(area.id, this.minutesFor(area));
  }

  stopArea(areaId: number): void {
    this.feedback.set('Bewässerung wird gestoppt.');
    this.runtime.stopArea(areaId);
  }

  statusForArea(area: Zone): 'disabled' | 'active' | 'watering' | 'scheduled-soon' | 'paused' | 'error' {
    return area.status;
  }

  manualDisabled(area: Zone): boolean {
    return !!this.manualDisabledReason(area);
  }

  manualDisabledReason(area: Zone): string {
    return area.manual_start_block_reason ?? '';
  }

  openSchedules(zoneId?: number): void {
    void this.router.navigate(['/schedules'], {
      queryParams: zoneId ? { zoneId } : {},
    });
  }
}
