import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AdaptiveIrrigationPlan, Zone, ZoneAdaptivePlanResponse, ZoneIrrigationProfile, ZoneProfileSuggestionResponse } from '../../core/api.models';
import { UiPreferencesService } from '../../core/ui-preferences.service';
import {
  DEFAULT_ZONE_PROFILE,
  DRYING_SPEED_LABELS,
  FREQUENCY_LABELS,
  PLANT_TYPE_LABELS,
  RAIN_EXPOSURE_LABELS,
  RISK_PROFILE_LABELS,
  STRATEGY_LABELS,
  SUN_EXPOSURE_LABELS,
  TIME_WINDOW_LABELS,
  WATER_NEED_LABELS,
  ZONE_TYPE_LABELS,
  baseWaterLabel,
  containerFactorLabel,
  diffLabel,
  formatMm,
  rainEffectivenessLabel,
  sensitivityLabel,
} from '../../core/zone-profile.utils';
import { AreaCardComponent } from '../../shared/area-card.component';
import { ExpertSectionComponent } from '../../shared/expert-section.component';
import { RuntimeFacade } from '../../state/runtime/runtime.facade';

type RecordingTarget = 'zoneDescription' | 'adjustmentInstruction';

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

        <div class="zone-assistant field-full">
          <div class="section-head">
            <div>
              <h3>KI-Zonenassistent</h3>
              <p class="muted">Beschreibe die Zone in Alltagssprache. Vorschläge werden erst aktiv, wenn du sie übernimmst und den Bereich speicherst.</p>
            </div>
          </div>

          <label class="field">
            <span>Beschreibe diese Zone</span>
            <div class="voice-input-shell">
              <textarea formControlName="zone_profile_description" placeholder="Zum Beispiel: Hochbeet mit Tomaten, volle Sonne, Regen kommt gut ran, Erde trocknet schnell aus."></textarea>
              <button
                class="microphone-button"
                type="button"
                [class.recording]="recordingTarget() === 'zoneDescription'"
                (click)="toggleRecording('zoneDescription')"
                [disabled]="assistantBusy()"
                aria-label="Zonenbeschreibung per Sprache eingeben"
                title="Zonenbeschreibung per Sprache eingeben"
              >
                <span aria-hidden="true">🎙</span>
              </button>
            </div>
          </label>

          <div class="toolbar">
            <button class="button secondary" type="button" (click)="suggestProfile()" [disabled]="assistantBusy()">Parameter vorschlagen</button>
            <button class="button secondary" type="button" *ngIf="selectedArea" (click)="adjustProfile()" [disabled]="assistantBusy() || !adjustmentInstruction().trim()">Parameter per KI anpassen</button>
          </div>
          <p class="muted" *ngIf="recording()">Aufnahme läuft. Tippe erneut auf das Mikrofon, um zu transkribieren.</p>

          <label class="field" *ngIf="selectedArea">
            <span>Parameter per KI anpassen</span>
            <div class="voice-input-shell">
              <textarea [value]="adjustmentInstruction()" (input)="adjustmentInstruction.set($any($event.target).value)" placeholder="Zum Beispiel: Es wird zu viel bewässert, bitte wassersparender einstellen."></textarea>
              <button
                class="microphone-button"
                type="button"
                [class.recording]="recordingTarget() === 'adjustmentInstruction'"
                (click)="toggleRecording('adjustmentInstruction')"
                [disabled]="assistantBusy()"
                aria-label="Anpassungswunsch per Sprache eingeben"
                title="Anpassungswunsch per Sprache eingeben"
              >
                <span aria-hidden="true">🎙</span>
              </button>
            </div>
          </label>

          <div class="assistant-suggestion" *ngIf="profileSuggestion() as suggestion">
            <strong>Vorschlag</strong>
            <p>{{ suggestion.summary.join(' · ') }}</p>
            <p>{{ suggestion.explanation }}</p>
            <ul *ngIf="suggestion.diff.length">
              <li *ngFor="let item of suggestion.diff">{{ diffLabel(item) }}</li>
            </ul>
            <p class="notice warning" *ngFor="let warning of suggestion.warnings">{{ warning }}</p>
            <div class="toolbar">
              <button class="button" type="button" (click)="applySuggestion()">Übernehmen</button>
              <button class="button secondary" type="button" (click)="discardSuggestion()">Verwerfen</button>
            </div>
          </div>

          <div class="profile-editor" [formGroup]="profileForm">
            <label class="field" title="Grundkategorie der Fläche. Beeinflusst Regenanrechnung, Gefäßfaktor und typische Bewässerungsfrequenz.">
              <span>Zonentyp</span>
              <select formControlName="zoneType">
                <option *ngFor="let option of zoneTypeOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field" title="Pflanzengruppe. Beeinflusst den fachlichen Basisbedarf und das Trockenstress-Risiko.">
              <span>Pflanzentyp</span>
              <select formControlName="plantType">
                <option *ngFor="let option of plantTypeOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field" title="Sonnenlage. Erhöht oder reduziert später den Bedarf über die Sonnenreaktion.">
              <span>Sonnenlage</span>
              <select formControlName="sunExposure">
                <option *ngFor="let option of sunExposureOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field" title="Wie gut Regen die Zone überhaupt erreicht. Zusammen mit Regenwirksamkeit reduziert das den automatischen Wasserbedarf.">
              <span>Regenkontakt</span>
              <select formControlName="rainExposure">
                <option *ngFor="let option of rainExposureOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field" title="0 bedeutet Regen zählt gar nicht, 1 bedeutet Regen wird vollständig vom Bedarf abgezogen.">
              <span>Regen zählt für diese Zone: {{ rainEffectivenessLabel(profileForm.controls.rainEffectiveness.value) }}</span>
              <input type="range" min="0" max="1" step="0.05" formControlName="rainEffectiveness" />
            </label>
            <label class="field" title="Fachliche Bedarfsklasse für die Zusammenfassung. Die genaue automatische Berechnung nutzt zusätzlich den Expertenwert Basiswasserbedarf.">
              <span>Wasserbedarf</span>
              <select formControlName="waterNeedLevel">
                <option *ngFor="let option of waterNeedOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field" title="Schnell trocknende Zonen werden bei automatischen Läufen eher höher oder häufiger bewässert.">
              <span>Trocknet aus</span>
              <select formControlName="dryingSpeed">
                <option *ngFor="let option of dryingSpeedOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field" title="Beschreibt, ob automatische Bewässerung eher selten und tief oder häufiger und kürzer geplant werden sollte.">
              <span>Bewässerungsrhythmus</span>
              <select formControlName="wateringFrequencyPreference">
                <option *ngFor="let option of frequencyOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field" title="Bevorzugte Tageszeit. Manuelle Starts bleiben davon unberührt.">
              <span>Bevorzugte Zeit</span>
              <select formControlName="preferredTimeWindow">
                <option *ngFor="let option of timeWindowOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field" title="Wassersparend reduziert automatische Laufzeiten eher, wachstumsorientiert hält mehr Reserve gegen Trockenstress.">
              <span>Strategie</span>
              <select formControlName="strategy">
                <option *ngFor="let option of strategyOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="field" title="Entscheidet bei Unsicherheit: eher Überwässerung vermeiden oder Trockenstress vermeiden.">
              <span>Risikoprofil</span>
              <select formControlName="riskProfile">
                <option *ngFor="let option of riskProfileOptions" [ngValue]="option.value">{{ option.label }}</option>
              </select>
            </label>
          </div>

          <app-expert-section [enabled]="expertMode()" title="Expertenwerte des Zonenprofils">
            <div class="form-grid form-grid-balanced" [formGroup]="profileForm">
              <label class="field field-span-3" title="Täglicher Grundbedarf in Millimeter. Aus diesem Wert wird der Laufzeitfaktor für automatische Zeitpläne abgeleitet.">
                <span>Basiswasserbedarf: {{ baseWaterLabel(profileForm.controls.baseWaterNeedMmPerDay.value) }}</span>
                <input type="number" min="0" max="20" step="0.1" formControlName="baseWaterNeedMmPerDay" />
                <small>{{ formatMm(profileForm.controls.baseWaterNeedMmPerDay.value) }}</small>
              </label>
              <label class="field field-span-3" title="Je höher der Wert, desto stärker verlängert Hitze automatische Läufe.">
                <span>Hitzereaktion: {{ sensitivityLabel(profileForm.controls.temperatureSensitivity.value) }}</span>
                <input type="number" min="0.5" max="2" step="0.1" formControlName="temperatureSensitivity" />
              </label>
              <label class="field field-span-3" title="Je höher der Wert, desto stärker verlängern sonnige Tage automatische Läufe.">
                <span>Sonnenreaktion: {{ sensitivityLabel(profileForm.controls.sunSensitivity.value) }}</span>
                <input type="number" min="0.5" max="2" step="0.1" formControlName="sunSensitivity" />
              </label>
              <label class="field field-span-3" title="Kübel und Hochbeete haben weniger Erdvolumen. Ein höherer Faktor erhöht automatische Laufzeiten moderat.">
                <span>Gefäßfaktor: {{ containerFactorLabel(profileForm.controls.containerFactor.value) }}</span>
                <input type="number" min="1" max="2.5" step="0.1" formControlName="containerFactor" />
              </label>
              <label class="field field-full">
                <span>Erklärung</span>
                <textarea formControlName="explanation"></textarea>
              </label>
            </div>
          </app-expert-section>

          <div class="adaptive-plan-panel" [formGroup]="planForm">
            <div class="section-head">
              <div>
                <h3>Adaptiver KI-Zeitplan</h3>
                <p class="muted">Die KI schlägt Regeln vor. Aktiv werden sie erst, wenn du den adaptiven Modus speicherst.</p>
              </div>
              <button class="button secondary" type="button" (click)="suggestAdaptivePlan()" [disabled]="assistantBusy()">Regeln vorschlagen</button>
            </div>

            <label class="field" title="Static nutzt die bisherigen Zeitpläne unverändert. Adaptive erzeugt automatische Läufe aus Profil, Wetter und diesen Regeln.">
              <span>Automatikmodus</span>
              <select formControlName="scheduling_mode">
                <option value="static">Statische Zeitpläne verwenden</option>
                <option value="adaptive">KI-adaptiven Zeitplan verwenden</option>
              </select>
            </label>

            <div class="assistant-suggestion" *ngIf="planSuggestion() as suggestion">
              <strong>Regelvorschlag</strong>
              <p>{{ suggestion.summary.join(' · ') }}</p>
              <p>{{ suggestion.explanation }}</p>
              <p class="notice warning" *ngFor="let warning of suggestion.warnings">{{ warning }}</p>
              <div class="toolbar">
                <button class="button" type="button" (click)="applyPlanSuggestion()">Regeln übernehmen</button>
                <button class="button secondary" type="button" (click)="discardPlanSuggestion()">Verwerfen</button>
              </div>
            </div>

            <div class="profile-editor">
              <label class="field" title="Bewässerungsart beeinflusst, ob Mittag grundsätzlich vermieden wird. Bei Sprengern wird Mittag vermieden, Tröpfchen ist flexibler.">
                <span>Bewässerungsart</span>
                <select formControlName="irrigationMethod">
                  <option value="unknown">Unbekannt</option>
                  <option value="sprinkler">Sprenger / Regner</option>
                  <option value="drip">Tröpfchenbewässerung</option>
                  <option value="soaker_hose">Perlschlauch</option>
                  <option value="manual">Manuell beobachtet</option>
                </select>
              </label>
              <label class="field" title="In diesen Fenstern darf der Scheduler automatische Läufe erzeugen. Er entscheidet trotzdem wetterabhängig, ob wirklich gegossen wird.">
                <span>Zeitfenster</span>
                <select formControlName="preferredTimeWindow">
                  <option *ngFor="let option of timeWindowOptions" [ngValue]="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label class="field" title="Wenn aktiv, erzeugt der adaptive Modus keine Mittagsläufe. Für Rasen ist das fachlich sinnvoll.">
                <span>Mittag vermeiden</span>
                <select formControlName="avoidMidday">
                  <option [ngValue]="true">Ja</option>
                  <option [ngValue]="false">Nein</option>
                </select>
              </label>
              <label class="field" title="Erlaubt bei hohem Netto-Bedarf einen zweiten kurzen Lauf, zum Beispiel bei Kübeln an heißen Tagen.">
                <span>Zweiter Lauf am Tag</span>
                <select formControlName="allowSecondDailyRun">
                  <option [ngValue]="false">Nein</option>
                  <option [ngValue]="true">Ja</option>
                </select>
              </label>
              <label class="field" title="So lange wartet der Scheduler mindestens seit dem letzten adaptiven Lauf. Manuelle Läufe sind davon nicht betroffen.">
                <span>Mindestabstand (Stunden)</span>
                <input type="number" min="1" max="72" formControlName="minIntervalHours" />
              </label>
              <label class="field" title="Aus dieser Dauer startet die Formel. Sonne, Hitze, Regen und Zonenprofil verkürzen oder verlängern sie.">
                <span>Basisdauer (Minuten)</span>
                <input type="number" min="1" max="240" formControlName="baseDurationMinutes" />
              </label>
              <label class="field" title="Untergrenze für automatische Läufe, wenn Bewässerung fachlich sinnvoll ist.">
                <span>Min. adaptive Dauer</span>
                <input type="number" min="1" max="240" formControlName="minDurationMinutes" />
              </label>
              <label class="field" title="Obergrenze für automatische Läufe, zusätzlich zur maximalen Bereichslaufzeit.">
                <span>Max. adaptive Dauer</span>
                <input type="number" min="1" max="240" formControlName="maxDurationMinutes" />
              </label>
            </div>

            <app-expert-section [enabled]="expertMode()" title="Adaptive Formeln und Begründung">
              <div class="form-grid form-grid-balanced">
                <label class="field field-span-3" title="Ab dieser wirksam angerechneten Regenmenge wird ein automatischer Lauf ausgelassen.">
                  <span>Regen-Skip ab mm</span>
                  <input type="number" min="0" max="50" step="0.1" formControlName="rainSkipThresholdMm" />
                </label>
                <label class="field field-span-3" title="Ab dieser Regenprognose wartet der Scheduler, falls der Netto-Bedarf noch nicht hoch ist.">
                  <span>Regen-Verzögerung ab mm</span>
                  <input type="number" min="0" max="50" step="0.1" formControlName="rainDelayThresholdMm" />
                </label>
                <label class="field field-span-3" title="Ab dieser Tageshöchsttemperatur wird ein hoher Bedarf leichter angenommen.">
                  <span>Hitzegrenze °C</span>
                  <input type="number" min="0" max="50" step="0.5" formControlName="heatThresholdC" />
                </label>
                <label class="field field-span-3" title="Ab diesem Netto-Bedarf darf ein zweiter Lauf trotz Regenprognose sinnvoll sein.">
                  <span>Hoher Bedarf ab mm</span>
                  <input type="number" min="0" max="20" step="0.1" formControlName="highNeedThresholdMm" />
                </label>
                <label class="field field-full">
                  <span>Regeln</span>
                  <textarea formControlName="rulesText"></textarea>
                </label>
                <label class="field field-full">
                  <span>Erklärung</span>
                  <textarea formControlName="explanation"></textarea>
                </label>
              </div>
            </app-expert-section>
          </div>
        </div>

        <app-expert-section [enabled]="expertMode()" title="Hardware und Expertenoptionen">
          <div class="form-grid form-grid-balanced">
            <label class="field field-full">
              <span>Allgemeine Beschreibung</span>
              <textarea formControlName="description"></textarea>
            </label>
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
      <p class="notice" [class.success]="feedbackKind() === 'success'" [class.warning]="feedbackKind() === 'warning'" *ngIf="feedback()">{{ feedback() }}</p>
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runtime = inject(RuntimeFacade);

  readonly expertMode = computed(() => this.preferences.expertMode());
  readonly feedback = signal('');
  readonly feedbackKind = signal<'success' | 'warning'>('success');
  readonly assistantBusy = signal(false);
  readonly recording = signal(false);
  readonly recordingTarget = signal<RecordingTarget | null>(null);
  readonly adjustmentInstruction = signal('');
  readonly profileSuggestion = signal<ZoneProfileSuggestionResponse | null>(null);
  readonly planSuggestion = signal<ZoneAdaptivePlanResponse | null>(null);
  readonly minutes = signal<Record<number, number>>({});
  readonly showForm = signal(false);
  selectedArea: Zone | null = null;
  private mediaRecorder?: MediaRecorder;
  private audioChunks: Blob[] = [];

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
    zone_profile_description: [''],
  });

  readonly profileForm = this.fb.nonNullable.group({
    zoneType: [DEFAULT_ZONE_PROFILE.zoneType, Validators.required],
    plantType: [DEFAULT_ZONE_PROFILE.plantType, Validators.required],
    sunExposure: [DEFAULT_ZONE_PROFILE.sunExposure, Validators.required],
    rainExposure: [DEFAULT_ZONE_PROFILE.rainExposure, Validators.required],
    rainEffectiveness: [DEFAULT_ZONE_PROFILE.rainEffectiveness, Validators.required],
    waterNeedLevel: [DEFAULT_ZONE_PROFILE.waterNeedLevel, Validators.required],
    baseWaterNeedMmPerDay: [DEFAULT_ZONE_PROFILE.baseWaterNeedMmPerDay, Validators.required],
    temperatureSensitivity: [DEFAULT_ZONE_PROFILE.temperatureSensitivity, Validators.required],
    sunSensitivity: [DEFAULT_ZONE_PROFILE.sunSensitivity, Validators.required],
    containerFactor: [DEFAULT_ZONE_PROFILE.containerFactor, Validators.required],
    dryingSpeed: [DEFAULT_ZONE_PROFILE.dryingSpeed, Validators.required],
    wateringFrequencyPreference: [DEFAULT_ZONE_PROFILE.wateringFrequencyPreference, Validators.required],
    preferredTimeWindow: [DEFAULT_ZONE_PROFILE.preferredTimeWindow, Validators.required],
    strategy: [DEFAULT_ZONE_PROFILE.strategy, Validators.required],
    riskProfile: [DEFAULT_ZONE_PROFILE.riskProfile, Validators.required],
    explanation: [DEFAULT_ZONE_PROFILE.explanation, Validators.required],
  });

  readonly planForm = this.fb.nonNullable.group({
    scheduling_mode: ['static' as 'static' | 'adaptive', Validators.required],
    irrigationMethod: ['unknown' as AdaptiveIrrigationPlan['irrigationMethod'], Validators.required],
    preferredTimeWindow: ['early_morning' as AdaptiveIrrigationPlan['preferredTimeWindows'][number], Validators.required],
    avoidMidday: [true, Validators.required],
    allowSecondDailyRun: [false, Validators.required],
    minIntervalHours: [18, Validators.required],
    baseDurationMinutes: [8, Validators.required],
    minDurationMinutes: [2, Validators.required],
    maxDurationMinutes: [20, Validators.required],
    rainSkipThresholdMm: [4, Validators.required],
    rainDelayThresholdMm: [2, Validators.required],
    heatThresholdC: [28, Validators.required],
    highNeedThresholdMm: [3, Validators.required],
    rulesText: ['', Validators.required],
    explanation: ['Noch kein adaptiver Regelplan übernommen.', Validators.required],
  });

  readonly zoneTypeOptions = this.optionEntries(ZONE_TYPE_LABELS);
  readonly plantTypeOptions = this.optionEntries(PLANT_TYPE_LABELS);
  readonly sunExposureOptions = this.optionEntries(SUN_EXPOSURE_LABELS);
  readonly rainExposureOptions = this.optionEntries(RAIN_EXPOSURE_LABELS);
  readonly waterNeedOptions = this.optionEntries(WATER_NEED_LABELS);
  readonly dryingSpeedOptions = this.optionEntries(DRYING_SPEED_LABELS);
  readonly frequencyOptions = this.optionEntries(FREQUENCY_LABELS);
  readonly timeWindowOptions = this.optionEntries(TIME_WINDOW_LABELS);
  readonly strategyOptions = this.optionEntries(STRATEGY_LABELS);
  readonly riskProfileOptions = this.optionEntries(RISK_PROFILE_LABELS);

  readonly rainEffectivenessLabel = rainEffectivenessLabel;
  readonly sensitivityLabel = sensitivityLabel;
  readonly containerFactorLabel = containerFactorLabel;
  readonly baseWaterLabel = baseWaterLabel;
  readonly formatMm = formatMm;
  readonly diffLabel = diffLabel;

  constructor() {
    combineLatest([this.vm$, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([vm, params]) => {
        const zoneIdParam = params.get('zoneId');
        const zoneId = zoneIdParam ? Number(zoneIdParam) : NaN;
        if (!Number.isFinite(zoneId) || this.selectedArea?.id === zoneId) {
          return;
        }
        const area = vm.areas.find((item) => item.id === zoneId);
        if (area) {
          this.editArea(area, false);
        }
      });
  }

  saveArea(): void {
    const payload = {
      ...this.form.getRawValue(),
      irrigation_profile: this.currentProfile(),
      scheduling_mode: this.planForm.controls.scheduling_mode.value,
      adaptive_irrigation_plan: this.currentAdaptivePlan(),
    };
    const request$ = this.selectedArea
      ? this.api.updateZone(this.selectedArea.id, payload)
      : this.api.createZone(payload);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.setFeedback(this.selectedArea ? 'Bereich gespeichert.' : 'Bereich angelegt.');
      this.resetForm();
      this.runtime.load('areas-form-saved');
    });
  }

  openCreateForm(): void {
    this.selectedArea = null;
    this.showForm.set(true);
    this.resetFormState(false);
    this.clearZoneRouteParam();
    requestAnimationFrame(() => {
      this.areaFormPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  editArea(area: Zone, updateRoute = true): void {
    this.selectedArea = area;
    this.showForm.set(true);
    if (updateRoute) {
      void this.router.navigate(['/areas'], { queryParams: { zoneId: area.id }, replaceUrl: true });
    }
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
      zone_profile_description: area.zone_profile_description ?? '',
    });
    this.patchProfile(area.irrigation_profile ?? DEFAULT_ZONE_PROFILE);
    this.patchPlan(area.scheduling_mode ?? 'static', area.adaptive_irrigation_plan ?? null);
    this.profileSuggestion.set(null);
    this.planSuggestion.set(null);
    this.adjustmentInstruction.set('');
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
      zone_profile_description: '',
    });
    this.patchProfile(DEFAULT_ZONE_PROFILE);
    this.patchPlan('static', null);
    this.profileSuggestion.set(null);
    this.planSuggestion.set(null);
    this.adjustmentInstruction.set('');
    if (closeForm) {
      this.showForm.set(false);
      this.clearZoneRouteParam();
    }
  }

  suggestProfile(): void {
    const description = this.form.controls.zone_profile_description.value.trim() || this.form.controls.description.value.trim();
    if (description.length < 5) {
      this.setFeedback('Bitte beschreibe die Zone etwas genauer.', 'warning');
      return;
    }
    this.assistantBusy.set(true);
    this.api.suggestZoneProfile({ description, current_profile: this.currentProfile() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (suggestion) => {
          this.profileSuggestion.set(suggestion);
          this.assistantBusy.set(false);
        },
        error: (error) => {
          this.setFeedback(this.apiErrorMessage(error, 'Der KI-Vorschlag konnte nicht erzeugt werden.'), 'warning');
          this.assistantBusy.set(false);
        },
      });
  }

  adjustProfile(): void {
    if (!this.selectedArea) {
      return;
    }
    this.assistantBusy.set(true);
    this.api.adjustZoneProfile(this.selectedArea.id, {
      instruction: this.adjustmentInstruction(),
      description: this.form.controls.zone_profile_description.value,
      current_profile: this.currentProfile(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (suggestion) => {
          this.profileSuggestion.set(suggestion);
          this.assistantBusy.set(false);
        },
        error: (error) => {
          this.setFeedback(this.apiErrorMessage(error, 'Die KI-Anpassung konnte nicht erzeugt werden.'), 'warning');
          this.assistantBusy.set(false);
        },
      });
  }

  applySuggestion(): void {
    const suggestion = this.profileSuggestion();
    if (!suggestion) {
      return;
    }
    this.patchProfile(suggestion.profile);
    this.profileSuggestion.set(null);
    this.setFeedback('Vorschlag übernommen. Speichere den Bereich, damit die Werte aktiv werden.');
  }

  discardSuggestion(): void {
    this.profileSuggestion.set(null);
  }

  suggestAdaptivePlan(): void {
    this.assistantBusy.set(true);
    this.api.suggestAdaptivePlan({
      description: this.form.controls.zone_profile_description.value || this.form.controls.description.value,
      profile: this.currentProfile(),
      max_duration_minutes: Number(this.form.controls.max_duration_minutes.value),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (suggestion) => {
        this.planSuggestion.set(suggestion);
        this.assistantBusy.set(false);
      },
      error: (error) => {
        this.setFeedback(this.apiErrorMessage(error, 'Der adaptive Regelvorschlag konnte nicht erzeugt werden.'), 'warning');
        this.assistantBusy.set(false);
      },
    });
  }

  applyPlanSuggestion(): void {
    const suggestion = this.planSuggestion();
    if (!suggestion) {
      return;
    }
    this.patchPlan('adaptive', suggestion.plan);
    this.planSuggestion.set(null);
    this.setFeedback('Adaptive Regeln übernommen. Speichere den Bereich, damit der KI-Modus aktiv wird.');
  }

  discardPlanSuggestion(): void {
    this.planSuggestion.set(null);
  }

  async toggleRecording(target: RecordingTarget): Promise<void> {
    if (this.recording()) {
      this.mediaRecorder?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setFeedback('Sprachaufnahme wird von diesem Browser nicht unterstützt.', 'warning');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
      this.mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void this.transcribeRecording();
      };
      this.mediaRecorder.start();
      this.recording.set(true);
      this.recordingTarget.set(target);
    } catch {
      this.setFeedback('Mikrofon konnte nicht gestartet werden.', 'warning');
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
    this.setFeedback(`${area.name} wird gestartet.`);
    this.runtime.startArea(area.id, this.minutesFor(area));
  }

  stopArea(areaId: number): void {
    this.setFeedback('Bewässerung wird gestoppt.');
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

  private currentProfile(): ZoneIrrigationProfile {
    return {
      ...this.profileForm.getRawValue(),
      rainEffectiveness: Number(this.profileForm.controls.rainEffectiveness.value),
      baseWaterNeedMmPerDay: Number(this.profileForm.controls.baseWaterNeedMmPerDay.value),
      temperatureSensitivity: Number(this.profileForm.controls.temperatureSensitivity.value),
      sunSensitivity: Number(this.profileForm.controls.sunSensitivity.value),
      containerFactor: Number(this.profileForm.controls.containerFactor.value),
    };
  }

  private currentAdaptivePlan(): AdaptiveIrrigationPlan | null {
    const value = this.planForm.getRawValue();
    return {
      irrigationMethod: value.irrigationMethod,
      preferredTimeWindows: [value.preferredTimeWindow],
      avoidMidday: Boolean(value.avoidMidday),
      allowSecondDailyRun: Boolean(value.allowSecondDailyRun),
      minIntervalHours: Number(value.minIntervalHours),
      baseDurationMinutes: Number(value.baseDurationMinutes),
      minDurationMinutes: Number(value.minDurationMinutes),
      maxDurationMinutes: Number(value.maxDurationMinutes),
      rainSkipThresholdMm: Number(value.rainSkipThresholdMm),
      rainDelayThresholdMm: Number(value.rainDelayThresholdMm),
      heatThresholdC: Number(value.heatThresholdC),
      highNeedThresholdMm: Number(value.highNeedThresholdMm),
      rules: value.rulesText.split('\n').map((line) => line.trim()).filter(Boolean),
      explanation: value.explanation,
    };
  }

  private patchProfile(profile: ZoneIrrigationProfile): void {
    this.profileForm.reset({
      ...DEFAULT_ZONE_PROFILE,
      ...profile,
    });
  }

  private patchPlan(mode: 'static' | 'adaptive', plan: AdaptiveIrrigationPlan | null): void {
    this.planForm.reset({
      scheduling_mode: mode,
      irrigationMethod: plan?.irrigationMethod ?? 'unknown',
      preferredTimeWindow: plan?.preferredTimeWindows?.[0] ?? 'early_morning',
      avoidMidday: plan?.avoidMidday ?? true,
      allowSecondDailyRun: plan?.allowSecondDailyRun ?? false,
      minIntervalHours: plan?.minIntervalHours ?? 18,
      baseDurationMinutes: plan?.baseDurationMinutes ?? 8,
      minDurationMinutes: plan?.minDurationMinutes ?? 2,
      maxDurationMinutes: plan?.maxDurationMinutes ?? 20,
      rainSkipThresholdMm: plan?.rainSkipThresholdMm ?? 4,
      rainDelayThresholdMm: plan?.rainDelayThresholdMm ?? 2,
      heatThresholdC: plan?.heatThresholdC ?? 28,
      highNeedThresholdMm: plan?.highNeedThresholdMm ?? 3,
      rulesText: (plan?.rules ?? []).join('\n'),
      explanation: plan?.explanation ?? 'Noch kein adaptiver Regelplan übernommen.',
    });
  }

  private async transcribeRecording(): Promise<void> {
    const target = this.recordingTarget();
    this.recording.set(false);
    this.recordingTarget.set(null);
    if (!this.audioChunks.length) {
      return;
    }
    this.assistantBusy.set(true);
    const blob = new Blob(this.audioChunks, { type: this.audioChunks[0]?.type || 'audio/webm' });
    const base64 = await this.blobToBase64(blob);
    this.api.transcribeZoneAudio({
      audio_base64: base64,
      filename: 'zone-description.webm',
      mime_type: blob.type || 'audio/webm',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ text }) => {
        this.applyTranscription(target, text);
        this.setFeedback('Sprachtext übernommen.');
        this.assistantBusy.set(false);
      },
      error: (error) => {
        this.setFeedback(this.apiErrorMessage(error, 'Die Sprachaufnahme konnte nicht transkribiert werden.'), 'warning');
        this.assistantBusy.set(false);
      },
    });
  }

  private applyTranscription(target: RecordingTarget | null, text: string): void {
    if (target === 'adjustmentInstruction') {
      const current = this.adjustmentInstruction().trim();
      this.adjustmentInstruction.set(current ? `${current}\n${text}` : text);
      return;
    }
    const current = this.form.controls.zone_profile_description.value.trim();
    this.form.controls.zone_profile_description.setValue(current ? `${current}\n${text}` : text);
  }

  private clearZoneRouteParam(): void {
    void this.router.navigate(['/areas'], {
      queryParams: { zoneId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private setFeedback(message: string, kind: 'success' | 'warning' = 'success'): void {
    this.feedbackKind.set(kind);
    this.feedback.set(message);
  }

  private apiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.detail === 'string') {
      return error.error.detail;
    }
    return fallback;
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private optionEntries<T extends string>(labels: Record<T, string>): Array<{ value: T; label: string }> {
    return Object.entries(labels).map(([value, label]) => ({ value: value as T, label: label as string }));
  }
}
