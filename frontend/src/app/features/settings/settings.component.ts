import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { AppSettings } from '../../core/api.models';
import { UiPreferencesService } from '../../core/ui-preferences.service';
import { ExpertSectionComponent } from '../../shared/expert-section.component';

@Component({
  standalone: true,
  selector: 'app-settings',
  imports: [CommonModule, ReactiveFormsModule, ExpertSectionComponent],
  template: `
    <section class="page-title">
      <h2>Einstellungen</h2>
      <p>Standort, Wettersteuerung und Systemverhalten verständlich anpassen.</p>
    </section>

    <section class="panel">
      <form [formGroup]="form" class="form-grid form-grid-balanced settings-form-grid" (ngSubmit)="save()">
        <label class="field field-span-4">
          <span>Ort oder Gartenname</span>
          <input formControlName="location_name" placeholder="z. B. Zuhause, Musterstadt" />
        </label>
        <label class="field field-span-2">
          <span>PLZ</span>
          <input formControlName="postal_code" placeholder="z. B. 10115" />
        </label>
        <label class="field field-span-2">
          <span>Wettersteuerung aktiv</span>
          <select formControlName="weather_enabled">
            <option [ngValue]="true">Ja</option>
            <option [ngValue]="false">Nein</option>
          </select>
        </label>
        <label class="field field-span-2">
          <span>Regenwahrscheinlichkeit ab</span>
          <input type="number" formControlName="weather_probability_threshold" />
        </label>
        <label class="field field-span-2">
          <span>Regenmenge ab</span>
          <input type="number" step="0.1" formControlName="weather_precipitation_mm_threshold" />
        </label>
        <label class="field field-span-3">
          <span>Betrachtungszeitraum in Stunden</span>
          <input type="number" formControlName="weather_window_hours" />
        </label>
        <label class="field field-span-3">
          <span>Wenn Wetterdaten nicht verfügbar sind</span>
          <select formControlName="weather_fail_mode">
            <option value="deny">Nicht bewässern</option>
            <option value="allow">Trotzdem bewässern</option>
          </select>
          <small class="muted">Wenn du „Nicht bewässern“ wählst, startet die Anlage bei fehlenden Wetterdaten sicherheitshalber nicht.</small>
        </label>

        <app-expert-section [enabled]="expertMode()" title="Koordinaten und Expertenwerte">
          <div class="form-grid form-grid-balanced">
            <label class="field field-span-3">
              <span>Latitude</span>
              <input type="number" step="0.0001" formControlName="latitude" />
            </label>
            <label class="field field-span-3">
              <span>Longitude</span>
              <input type="number" step="0.0001" formControlName="longitude" />
            </label>
          </div>
        </app-expert-section>

        <div class="toolbar field-full">
          <button class="button" type="submit">Einstellungen speichern</button>
        </div>
      </form>
      <p class="notice success" *ngIf="feedback()">{{ feedback() }}</p>
    </section>

    <section #winterSection class="panel">
      <div class="section-head">
        <div>
          <h3>Winterbetrieb</h3>
          <p class="muted">Schalte die Anlage für die kalte Jahreszeit bewusst in einen sicheren Zustand.</p>
        </div>
      </div>

      <p class="notice success" *ngIf="form.controls.winter_mode_active.value">
        Winterbetrieb aktiv. Automatische Bewässerung ist ausgeschaltet und alle Ventile bleiben geschlossen.
      </p>

      <div class="form-grid form-grid-balanced settings-form-grid">
        <label class="field field-span-4">
          <span>Manuelle Starts im Winterbetrieb</span>
          <select [formControl]="form.controls.winter_disable_manual_start">
            <option [ngValue]="true">Deaktivieren</option>
            <option [ngValue]="false">Erlauben</option>
          </select>
        </label>
        <label class="field field-span-4">
          <span>Zeitpläne im Winterbetrieb</span>
          <select [formControl]="form.controls.winter_pause_schedules">
            <option [ngValue]="true">Pausieren</option>
            <option [ngValue]="false">Weiter anzeigen</option>
          </select>
        </label>
        <label class="field field-span-4">
          <span>Sicherheitsabschaltung beim Aktivieren</span>
          <select [formControl]="form.controls.safety_shutdown_on_winter">
            <option [ngValue]="true">Ausführen</option>
            <option [ngValue]="false">Nicht ausführen</option>
          </select>
        </label>
      </div>

      <div class="toolbar">
        <button
          class="button"
          type="button"
          *ngIf="!form.controls.winter_mode_active.value"
          (click)="toggleWinterMode(true)"
        >
          Winterbetrieb aktivieren
        </button>
        <button
          class="button secondary"
          type="button"
          *ngIf="form.controls.winter_mode_active.value"
          (click)="toggleWinterMode(false)"
        >
          Winterbetrieb beenden
        </button>
      </div>
    </section>
  `,
})
export class SettingsComponent {
  @ViewChild('winterSection')
  private winterSection?: ElementRef<HTMLElement>;

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly preferences = inject(UiPreferencesService);
  private readonly route = inject(ActivatedRoute);

  readonly expertMode = computed(() => this.preferences.expertMode());
  readonly feedback = signal('');

  readonly form = this.fb.nonNullable.group({
    location_name: ['Mein Garten', Validators.required],
    postal_code: [''],
    latitude: [52.52, Validators.required],
    longitude: [13.405, Validators.required],
    weather_enabled: [true, Validators.required],
    weather_window_hours: [6, Validators.required],
    weather_probability_threshold: [70, Validators.required],
    weather_precipitation_mm_threshold: [2, Validators.required],
    weather_fail_mode: ['allow' as 'allow' | 'deny', Validators.required],
    winter_mode_active: [false, Validators.required],
    winter_disable_manual_start: [true, Validators.required],
    winter_pause_schedules: [true, Validators.required],
    safety_shutdown_on_winter: [true, Validators.required],
    system_paused_until: [''],
    safety_stop_active: [false, Validators.required],
    safety_stop_reason: [''],
  });

  constructor() {
    this.api.getSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((settings) => {
      this.patchSettings(settings);
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.get('section') === 'winter') {
        requestAnimationFrame(() => {
          this.winterSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    });
  }

  save(): void {
    const raw = this.form.getRawValue();
    this.api.updateSettings({
      ...raw,
      postal_code: raw.postal_code || null,
      system_paused_until: raw.system_paused_until || null,
      safety_stop_reason: raw.safety_stop_reason || null,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.feedback.set('Einstellungen gespeichert.');
    });
  }

  toggleWinterMode(active: boolean): void {
    const raw = this.form.getRawValue();
    this.api.updateWinterMode({
      active,
      disable_manual_start: raw.winter_disable_manual_start,
      pause_schedules: raw.winter_pause_schedules,
      safety_shutdown: raw.safety_shutdown_on_winter,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((settings) => {
      this.patchSettings(settings);
      this.feedback.set(active ? 'Winterbetrieb aktiviert.' : 'Winterbetrieb beendet.');
    });
  }

  private patchSettings(settings: AppSettings): void {
    this.form.patchValue({
      ...settings,
      postal_code: settings.postal_code ?? '',
      system_paused_until: settings.system_paused_until ?? '',
      safety_stop_reason: settings.safety_stop_reason ?? '',
    });
  }
}
