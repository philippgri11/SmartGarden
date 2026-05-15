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
type AssistantStep = 'describe' | 'profile' | 'automation';

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
  selector: 'app-zones',
  imports: [CommonModule, ReactiveFormsModule, AreaCardComponent, ExpertSectionComponent],
  template: `
    <section class="page-title">
      <h2>Bereiche</h2>
      <p>Hier legst du Bereiche an, passt Standarddauern an und steuerst jeden Bereich direkt.</p>
    </section>

    <section class="panel compact-action-panel" *ngIf="!showForm()">
      <div class="toolbar">
        <button class="button button-subtle" type="button" (click)="openCreateForm()">Bereich anlegen</button>
      </div>
    </section>

    <section #areaFormPanel class="panel" *ngIf="showForm()">
      <div class="section-head">
        <div>
          <h3>{{ selectedArea ? 'Bereich bearbeiten' : 'Neuen Bereich anlegen' }}</h3>
          <p class="muted">{{ selectedArea && !areaEditing() ? 'Anzeigeansicht: keine Werte werden verändert.' : 'Technikdetails erscheinen nur im Expertenmodus.' }}</p>
        </div>
        <button class="button secondary" type="button" (click)="resetForm()">Schließen</button>
      </div>

      <div class="view-summary" *ngIf="selectedArea && !areaEditing()">
        <div>
          <span>Name</span>
          <strong>{{ selectedArea.name }}</strong>
        </div>
        <div>
          <span>Manuell</span>
          <strong>{{ selectedArea.default_manual_duration_minutes }} min, max. {{ selectedArea.max_duration_minutes }} min</strong>
        </div>
        <div>
          <span>Automatik</span>
          <strong>{{ selectedArea.scheduling_mode === 'adaptive' ? 'KI-adaptiv' : 'Feste Zeitpläne' }}</strong>
        </div>
        <div>
          <span>Wetter</span>
          <strong>{{ selectedArea.weather_enabled ? 'aktiv' : 'aus' }}</strong>
        </div>
        <button class="button button-subtle" type="button" (click)="areaEditing.set(true)">Bereich bearbeiten</button>
      </div>

      <form *ngIf="!selectedArea || areaEditing()" [formGroup]="form" class="form-grid form-grid-balanced zones-form-grid" (ngSubmit)="saveArea()">
        <label class="field field-span-4">
          <span>Name</span>
          <input formControlName="name" />
        </label>
        <label class="field field-span-2">
          <span>Standarddauer für manuellen Start <span class="info-dot" title="Gilt nur, wenn du diesen Bereich manuell startest oder alle Bereiche nacheinander bewässerst. Automatische Regeln können eigene Laufzeiten berechnen.">i</span></span>
          <input type="number" formControlName="default_manual_duration_minutes" />
        </label>
        <label class="field field-span-2">
          <span>Maximale Laufzeit <span class="info-dot" title="Sicherheitslimit für manuelle und automatische Läufe. Längere KI- oder Zeitplanwerte werden auf diese Dauer begrenzt.">i</span></span>
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
          <span>Wettersteuerung <span class="info-dot" title="Wenn aktiv, prüft die App vor automatischen Läufen Wetterdaten. Bei KI-adaptiv fließen Wetter und Zonenprofil zusätzlich in Dauer und Auslassen ein.">i</span></span>
          <select formControlName="weather_enabled">
            <option [ngValue]="true">Ja</option>
            <option [ngValue]="false">Nein</option>
          </select>
        </label>

        <div class="zone-assistant field-full">
          <div class="section-head">
            <div>
              <h3>KI-Assistent</h3>
              <p class="muted">Ein Satz reicht: Was wächst hier, wie sonnig ist es, kommt Regen hin?</p>
            </div>
          </div>

          <div class="assistant-flow">
            <button class="assistant-step" type="button" [class.active]="assistantStep() === 'describe'" (click)="assistantStep.set('describe')">
              <span>1</span>
              <strong>Beschreiben</strong>
              <small>Alltagssprache oder Spracheingabe.</small>
            </button>
            <button class="assistant-step" type="button" [class.active]="assistantStep() === 'profile'" [disabled]="!hasProfileInput()" (click)="assistantStep.set('profile')">
              <span>2</span>
              <strong>Vorschlag prüfen</strong>
              <small>Wasserbedarf, Tageszeit und Risiko.</small>
            </button>
            <button class="assistant-step" type="button" [class.active]="assistantStep() === 'automation'" (click)="assistantStep.set('automation')">
              <span>3</span>
              <strong>Automatik wählen</strong>
              <small>Zeitplan oder KI-Regel.</small>
            </button>
          </div>

          <div class="assistant-progress" *ngIf="assistantBusy()">
            <div class="spinner" aria-hidden="true"></div>
            <div>
              <strong>{{ assistantBusyText() }}</strong>
              <div class="progress-bar"><span></span></div>
            </div>
          </div>

          <ng-container *ngIf="assistantStep() === 'describe'">
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
                <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                  <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
                  <path d="M19 10.5a7 7 0 0 1-14 0" />
                  <path d="M12 17.5V21" />
                  <path d="M8.5 21h7" />
                </svg>
              </button>
            </div>
          </label>

          <div class="toolbar">
            <button class="button button-subtle" type="button" (click)="suggestProfile()" [disabled]="assistantBusy()">Vorschlag erstellen</button>
          </div>
          <p class="muted" *ngIf="recording()">Aufnahme läuft. Tippe erneut auf das Mikrofon, um zu transkribieren.</p>
          </ng-container>

          <ng-container *ngIf="assistantStep() === 'profile'">
          <p class="notice warning" *ngIf="!hasRealProfile() && !profileSuggestion()">
            Noch kein echter Profilvorschlag vorhanden. Beschreibe zuerst die Zone, damit Standardwerte nicht wie gespeicherte Werte wirken.
          </p>
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
                <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                  <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
                  <path d="M19 10.5a7 7 0 0 1-14 0" />
                  <path d="M12 17.5V21" />
                  <path d="M8.5 21h7" />
                </svg>
              </button>
            </div>
          </label>
          <div class="toolbar" *ngIf="selectedArea">
            <button class="button button-subtle" type="button" (click)="adjustProfile()" [disabled]="assistantBusy() || !adjustmentInstruction().trim()">Anpassung anwenden</button>
          </div>

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

          <div class="zone-profile-summary" *ngIf="hasRealProfile() || profileSuggestion()">
            <div>
              <span>Pflanzen</span>
              <strong>{{ PLANT_TYPE_LABELS[profileForm.controls.plantType.value] }}</strong>
            </div>
            <div>
              <span>Lage</span>
              <strong>{{ SUN_EXPOSURE_LABELS[profileForm.controls.sunExposure.value] }}</strong>
            </div>
            <div>
              <span>Wasserbedarf</span>
              <strong>{{ WATER_NEED_LABELS[profileForm.controls.waterNeedLevel.value] }}</strong>
            </div>
            <div>
              <span>Bevorzugt</span>
              <strong>{{ TIME_WINDOW_LABELS[profileForm.controls.preferredTimeWindow.value] }}</strong>
            </div>
          </div>
          <div class="toolbar">
            <button class="button button-subtle" type="button" (click)="assistantStep.set('describe')">Beschreibung ändern</button>
            <button class="button" type="button" (click)="assistantStep.set('automation')">Weiter zur Automatik</button>
          </div>

          <div class="profile-editor" [formGroup]="profileForm" *ngIf="expertMode()">
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
          </ng-container>

          <ng-container *ngIf="assistantStep() === 'automation'">
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
                <h3>Automatik</h3>
                <p class="muted">Statisch folgt festen Uhrzeiten. KI-adaptiv nutzt Zeitfenster, Wetter und Zonenprofil und verschiebt Läufe automatisch hinter manuelle Regeln.</p>
              </div>
            </div>

            <div class="automation-mode-grid">
              <button class="automation-mode-card" type="button" [class.active]="planForm.controls.scheduling_mode.value === 'static'" (click)="selectAutomationMode('static')">
                <strong>Feste Zeitpläne</strong>
                <span>Die Regeln im Tab Zeitpläne bestimmen Uhrzeit und Dauer. Wetter kann Läufe nur überspringen oder leicht anpassen.</span>
              </button>
              <button class="automation-mode-card" type="button" [class.active]="planForm.controls.scheduling_mode.value === 'adaptive'" (click)="selectAutomationMode('adaptive')">
                <strong>KI-adaptiv</strong>
                <span>Die Zone nutzt ein Zeitfenster. Bedarf, Wetter, Mindestabstand und andere Zonen bestimmen die konkrete Uhrzeit und Dauer.</span>
              </button>
            </div>

            <div class="fixed-schedule-panel" *ngIf="planForm.controls.scheduling_mode.value === 'static'">
              <div class="section-head">
                <div>
                  <h3>Fester Zeitplan</h3>
                  <p class="muted" *ngIf="!selectedArea">Dieser Zeitplan wird beim Anlegen des Bereichs direkt mitgespeichert.</p>
                  <p class="muted" *ngIf="selectedArea">Feste Regeln für bestehende Bereiche bearbeitest du im Tab Zeitpläne, damit keine Duplikate entstehen.</p>
                </div>
              </div>

              <ng-container *ngIf="!selectedArea">
                <div class="field">
                  <span>Wochentage</span>
                  <div class="weekday-grid">
                    <button
                      *ngFor="let day of weekdays"
                      type="button"
                      class="choice-pill"
                      [class.active]="fixedScheduleWeekdays().includes(day.id)"
                      (click)="toggleFixedScheduleWeekday(day.id)"
                    >
                      {{ day.label }}
                    </button>
                  </div>
                </div>

                <div class="form-grid form-grid-balanced">
                  <label class="field field-span-3">
                    <span>Startzeit</span>
                    <input type="time" formControlName="fixedStartTime" />
                  </label>
                  <label class="field field-span-3">
                    <span>Dauer</span>
                    <input type="number" min="1" formControlName="fixedDurationMinutes" />
                  </label>
                  <label class="field field-span-3">
                    <span>Wetter berücksichtigen</span>
                    <select formControlName="fixedWeatherEnabled">
                      <option [ngValue]="true">Ja</option>
                      <option [ngValue]="false">Nein</option>
                    </select>
                  </label>
                  <label class="field field-span-3" *ngIf="planForm.controls.fixedWeatherEnabled.value">
                    <span>Regenwahrscheinlichkeit ab (%)</span>
                    <input type="number" formControlName="fixedWeatherProbabilityThreshold" />
                  </label>
                  <label class="field field-span-3" *ngIf="planForm.controls.fixedWeatherEnabled.value">
                    <span>Regenmenge ab (mm)</span>
                    <input type="number" formControlName="fixedWeatherPrecipitationThreshold" />
                  </label>
                </div>

                <div class="schedule-preview">
                  <strong>Vorschau</strong>
                  <p>{{ fixedSchedulePreview() }}</p>
                </div>
              </ng-container>
            </div>

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

            <div class="adaptive-plan-summary">
              <div>
                <span>Modus</span>
                <strong>{{ planForm.controls.scheduling_mode.value === 'adaptive' ? 'KI-adaptiv' : 'Statisch' }}</strong>
              </div>
              <div>
                <span>Zeitfenster</span>
                <strong>{{ TIME_WINDOW_LABELS[planForm.controls.preferredTimeWindow.value] }}</strong>
              </div>
              <div>
                <span>Laufzeit</span>
                <strong>{{ planForm.controls.minDurationMinutes.value }}-{{ planForm.controls.maxDurationMinutes.value }} min</strong>
              </div>
            </div>
            <div class="toolbar">
              <button class="button button-subtle" type="button" (click)="suggestAdaptivePlan()" [disabled]="assistantBusy()">KI-Regeln vorschlagen</button>
              <button class="button button-subtle" type="button" (click)="assistantStep.set('profile')">Profil prüfen</button>
            </div>

            <div class="profile-editor" *ngIf="expertMode()">
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
          </ng-container>
        </div>

        <app-expert-section [enabled]="expertMode()" title="Hardware und Expertenoptionen">
          <div class="form-grid form-grid-balanced">
            <label class="field field-full">
              <span>Allgemeine Beschreibung</span>
              <textarea formControlName="description"></textarea>
            </label>
            <label class="field field-span-3" title="Auf dem aktuellen Raspberry Pi 3 liegen die 40-Pin-Header-GPIOs auf /dev/gpiochip0. Nur aendern, wenn die Hardware wirklich an einem anderen Chip haengt.">
              <span>GPIO-Chip <span class="info-dot" title="Raspberry Pi 3: normalerweise /dev/gpiochip0. Der Scheduler-Container bekommt genau dieses Device durchgereicht.">i</span></span>
              <input formControlName="gpio_chip" />
            </label>
            <label class="field field-span-3" title="Nummer der BCM-GPIO-Line, nicht die physische Pin-Nummer. Jede aktive Zone muss eine eigene Line verwenden. GPIO 0 und 1 sind fuer HAT-ID reserviert und sollten vermieden werden.">
              <span>GPIO-Line <span class="info-dot" title="BCM-Line auf dem GPIO-Chip. Beispiel: GPIO 17 ist Line 17. Nicht doppelt fuer aktive Bereiche verwenden.">i</span></span>
              <input type="number" min="0" max="53" formControlName="gpio_line" />
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
          <button class="button" type="submit" [disabled]="savingArea()">
            {{ savingArea() ? 'Speichert...' : (selectedArea ? 'Bereich speichern' : 'Bereich anlegen') }}
          </button>
          <button class="button secondary" type="button" (click)="resetForm()">Zurücksetzen</button>
        </div>
      </form>
      <p class="notice" [class.success]="feedbackKind() === 'success'" [class.warning]="feedbackKind() === 'warning'" *ngIf="feedback()">{{ feedback() }}</p>
    </section>

    <section class="panel" *ngIf="!showForm() && (vm$ | async) as vm">
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
  readonly savingArea = signal(false);
  readonly assistantBusyText = signal('');
  readonly assistantStep = signal<AssistantStep>('describe');
  readonly recording = signal(false);
  readonly recordingTarget = signal<RecordingTarget | null>(null);
  readonly adjustmentInstruction = signal('');
  readonly profileSuggestion = signal<ZoneProfileSuggestionResponse | null>(null);
  readonly planSuggestion = signal<ZoneAdaptivePlanResponse | null>(null);
  readonly profileReady = signal(false);
  readonly minutes = signal<Record<number, number>>({});
  readonly showForm = signal(false);
  readonly areaEditing = signal(false);
  readonly fixedScheduleWeekdays = signal<string[]>(['mon', 'wed', 'fri']);
  readonly weekdays = WEEKDAYS;
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
    fixedStartTime: ['06:00', Validators.required],
    fixedDurationMinutes: [5, Validators.required],
    fixedWeatherEnabled: [false, Validators.required],
    fixedWeatherProbabilityThreshold: [70],
    fixedWeatherPrecipitationThreshold: [2],
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
  readonly PLANT_TYPE_LABELS = PLANT_TYPE_LABELS;
  readonly SUN_EXPOSURE_LABELS = SUN_EXPOSURE_LABELS;
  readonly WATER_NEED_LABELS = WATER_NEED_LABELS;
  readonly TIME_WINDOW_LABELS = TIME_WINDOW_LABELS;

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
    if (this.planForm.controls.scheduling_mode.value === 'adaptive' && !this.hasRealProfile()) {
      this.setFeedback('Für KI-adaptive Regeln muss zuerst ein Profilvorschlag übernommen werden.', 'warning');
      return;
    }
    const isNewArea = !this.selectedArea;
    const rawForm = this.form.getRawValue();
    const payload = {
      ...rawForm,
      gpio_line: Number(rawForm.gpio_line),
      default_manual_duration_minutes: Number(rawForm.default_manual_duration_minutes),
      max_duration_minutes: Number(rawForm.max_duration_minutes),
      weather_probability_threshold: rawForm.weather_probability_threshold === null ? null : Number(rawForm.weather_probability_threshold),
      weather_precipitation_mm_threshold: rawForm.weather_precipitation_mm_threshold === null ? null : Number(rawForm.weather_precipitation_mm_threshold),
      irrigation_profile: this.hasRealProfile() ? this.currentProfile() : null,
      scheduling_mode: this.planForm.controls.scheduling_mode.value,
      adaptive_irrigation_plan: this.currentAdaptivePlan(),
    };
    const request$ = this.selectedArea
      ? this.api.updateZone(this.selectedArea.id, payload)
      : this.api.createZone(payload);
    this.savingArea.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (zone) => {
        if (isNewArea && this.planForm.controls.scheduling_mode.value === 'static') {
          this.api.createSchedule(this.fixedSchedulePayload(zone.id)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => this.finishAreaSave('Bereich und fester Zeitplan angelegt.'),
            error: (error) => {
              this.selectedArea = zone;
              this.areaEditing.set(false);
              this.runtime.load('areas-created-without-schedule');
              this.setFeedback(this.apiErrorMessage(error, 'Bereich wurde angelegt, der feste Zeitplan aber nicht.'), 'warning');
            },
          });
          return;
        }
        this.finishAreaSave(this.selectedArea ? 'Bereich gespeichert.' : 'Bereich angelegt.');
      },
      error: (error) => {
        this.savingArea.set(false);
        this.setFeedback(this.apiErrorMessage(error, 'Bereich konnte nicht gespeichert werden.'), 'warning');
      },
    });
  }

  openCreateForm(): void {
    this.selectedArea = null;
    this.showForm.set(true);
    this.areaEditing.set(true);
    this.resetFormState(false);
    this.assistantStep.set('describe');
    this.clearZoneRouteParam();
    requestAnimationFrame(() => {
      this.areaFormPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  editArea(area: Zone, updateRoute = true): void {
    this.selectedArea = area;
    this.showForm.set(true);
    this.areaEditing.set(false);
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
    this.profileReady.set(this.hasAreaProfile(area));
    this.adjustmentInstruction.set('');
    this.assistantStep.set(this.hasAreaProfile(area) ? 'profile' : 'describe');
    requestAnimationFrame(() => {
      this.areaFormPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  resetForm(): void {
    this.resetFormState(true);
  }

  private resetFormState(closeForm: boolean): void {
    this.selectedArea = null;
    this.areaEditing.set(false);
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
    this.profileReady.set(false);
    this.adjustmentInstruction.set('');
    this.fixedScheduleWeekdays.set(['mon', 'wed', 'fri']);
    this.assistantStep.set('describe');
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
    this.startAssistantWork('KI-Vorschlag wird erstellt...');
    this.api.suggestZoneProfile({ description, current_profile: this.currentProfile() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (suggestion) => {
          this.profileSuggestion.set(suggestion);
          this.assistantStep.set('profile');
          this.stopAssistantWork();
        },
        error: (error) => {
          this.setFeedback(this.apiErrorMessage(error, 'Der KI-Vorschlag konnte nicht erzeugt werden.'), 'warning');
          this.stopAssistantWork();
        },
      });
  }

  adjustProfile(): void {
    if (!this.selectedArea) {
      return;
    }
    this.startAssistantWork('KI-Anpassung wird berechnet...');
    this.api.adjustZoneProfile(this.selectedArea.id, {
      instruction: this.adjustmentInstruction(),
      description: this.form.controls.zone_profile_description.value,
      current_profile: this.currentProfile(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (suggestion) => {
          this.profileSuggestion.set(suggestion);
          this.assistantStep.set('profile');
          this.stopAssistantWork();
        },
        error: (error) => {
          this.setFeedback(this.apiErrorMessage(error, 'Die KI-Anpassung konnte nicht erzeugt werden.'), 'warning');
          this.stopAssistantWork();
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
    this.profileReady.set(true);
    this.assistantStep.set('automation');
    this.setFeedback('Vorschlag übernommen. Speichere den Bereich, damit die Werte aktiv werden.');
  }

  discardSuggestion(): void {
    this.profileSuggestion.set(null);
  }

  suggestAdaptivePlan(): void {
    this.startAssistantWork('Adaptive Regeln werden erstellt...');
    this.api.suggestAdaptivePlan({
      description: this.form.controls.zone_profile_description.value || this.form.controls.description.value,
      profile: this.currentProfile(),
      max_duration_minutes: Number(this.form.controls.max_duration_minutes.value),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (suggestion) => {
        this.planSuggestion.set(suggestion);
        this.stopAssistantWork();
      },
      error: (error) => {
        this.setFeedback(this.apiErrorMessage(error, 'Der adaptive Regelvorschlag konnte nicht erzeugt werden.'), 'warning');
        this.stopAssistantWork();
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
    this.assistantStep.set('automation');
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
      const mimeType = this.preferredAudioMimeType();
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
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
    if (value.scheduling_mode === 'static') {
      return null;
    }
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
      fixedStartTime: '06:00',
      fixedDurationMinutes: 5,
      fixedWeatherEnabled: false,
      fixedWeatherProbabilityThreshold: 70,
      fixedWeatherPrecipitationThreshold: 2,
    });
  }

  toggleFixedScheduleWeekday(dayId: string): void {
    const current = this.fixedScheduleWeekdays();
    const next = current.includes(dayId) ? current.filter((item) => item !== dayId) : [...current, dayId];
    this.fixedScheduleWeekdays.set(next.length ? next : [dayId]);
  }

  selectAutomationMode(mode: 'static' | 'adaptive'): void {
    if (mode === 'adaptive' && !this.hasRealProfile()) {
      this.setFeedback('Übernimm zuerst einen Profilvorschlag, damit KI-adaptive Regeln fachlich passen.', 'warning');
      return;
    }
    this.planForm.controls.scheduling_mode.setValue(mode);
  }

  fixedSchedulePreview(): string {
    const value = this.planForm.getRawValue();
    const days = this.fixedScheduleWeekdays()
      .map((dayId) => WEEKDAYS.find((day) => day.id === dayId)?.label ?? dayId)
      .join(', ');
    const minutes = this.fixedScheduleDurationMinutes();
    const weather = value.fixedWeatherEnabled ? 'Wetter wird berücksichtigt.' : 'Wetter wird nicht berücksichtigt.';
    return `${days} um ${value.fixedStartTime} Uhr für ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}. ${weather}`;
  }

  private fixedSchedulePayload(zoneId: number) {
    const value = this.planForm.getRawValue();
    return {
      zone_id: zoneId,
      active: true,
      weekdays: this.fixedScheduleWeekdays(),
      start_time: value.fixedStartTime,
      duration_minutes: this.fixedScheduleDurationMinutes(),
      interval_hours: null,
      window_start: null,
      window_end: null,
      weather_enabled: Boolean(value.fixedWeatherEnabled),
      weather_probability_threshold: Number(value.fixedWeatherProbabilityThreshold),
      weather_precipitation_mm_threshold: Number(value.fixedWeatherPrecipitationThreshold),
    };
  }

  private fixedScheduleDurationMinutes(): number {
    return Math.max(
      1,
      Math.min(
        Number(this.planForm.controls.fixedDurationMinutes.value),
        Number(this.form.controls.max_duration_minutes.value),
      ),
    );
  }

  private finishAreaSave(message: string): void {
    this.savingArea.set(false);
    this.setFeedback(message);
    this.resetForm();
    this.runtime.load('areas-form-saved');
  }

  private async transcribeRecording(): Promise<void> {
    const target = this.recordingTarget();
    this.recording.set(false);
    this.recordingTarget.set(null);
    if (!this.audioChunks.length) {
      return;
    }
    this.startAssistantWork('Sprachaufnahme wird transkribiert...');
    const blob = new Blob(this.audioChunks, { type: this.audioChunks[0]?.type || 'audio/webm' });
    const base64 = await this.blobToBase64(blob);
    this.api.transcribeZoneAudio({
      audio_base64: base64,
      filename: this.audioFilename(blob.type),
      mime_type: blob.type || 'audio/webm',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ text }) => {
        this.applyTranscription(target, text);
        this.setFeedback('Sprachtext übernommen.');
        this.stopAssistantWork();
      },
      error: (error) => {
        this.setFeedback(this.apiErrorMessage(error, 'Die Sprachaufnahme konnte nicht transkribiert werden.'), 'warning');
        this.stopAssistantWork();
      },
    });
  }

  hasProfileInput(): boolean {
    return this.form.controls.zone_profile_description.value.trim().length > 0 || this.hasRealProfile() || !!this.profileSuggestion();
  }

  hasRealProfile(): boolean {
    return this.profileReady() || this.hasAreaProfile(this.selectedArea);
  }

  private hasAreaProfile(area: Zone | null): boolean {
    return !!(area?.irrigation_profile || area?.zone_profile_description?.trim());
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

  private preferredAudioMimeType(): string {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
      return '';
    }
    return [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
    ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
  }

  private audioFilename(mimeType: string): string {
    if (mimeType.includes('ogg')) {
      return 'zone-description.ogg';
    }
    if (mimeType.includes('mp4')) {
      return 'zone-description.mp4';
    }
    if (mimeType.includes('mpeg')) {
      return 'zone-description.mp3';
    }
    if (mimeType.includes('wav')) {
      return 'zone-description.wav';
    }
    return 'zone-description.webm';
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

  private startAssistantWork(message: string): void {
    this.assistantBusyText.set(message);
    this.assistantBusy.set(true);
  }

  private stopAssistantWork(): void {
    this.assistantBusy.set(false);
    this.assistantBusyText.set('');
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
