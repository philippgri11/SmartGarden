import { CommonModule, DatePipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { Zone, ZoneIrrigationProfile } from '../core/api.models';
import {
  WATER_NEED_LABELS,
  ZONE_TYPE_LABELS,
  buildZoneProfileSummary,
  containerFactorLabel,
  rainEffectivenessLabel,
  sensitivityLabel,
} from '../core/zone-profile.utils';
import { AreaStatusBadgeComponent } from './area-status-badge.component';
import { ExpertSectionComponent } from './expert-section.component';
import { ManualRunControlComponent } from './manual-run-control.component';
import { WeatherAnalysisPanelComponent } from './weather-analysis-panel.component';
import { WeatherDecisionBadgeComponent } from './weather-decision-badge.component';

@Component({
  selector: 'app-area-card',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    AreaStatusBadgeComponent,
    WeatherDecisionBadgeComponent,
    ManualRunControlComponent,
    ExpertSectionComponent,
    WeatherAnalysisPanelComponent,
  ],
  template: `
    <article class="area-card">
      <div class="area-card-head">
        <div>
          <div class="eyebrow">Bereich</div>
          <h3>{{ area.name }}</h3>
          <p class="muted area-description" *ngIf="area.description">{{ area.description }}</p>
        </div>
        <app-area-status-badge [status]="status" />
      </div>

      <div class="area-profile-compact" *ngIf="area.irrigation_profile as profile">
        <div class="area-profile-compact-head">
          <strong>{{ zoneTypeLabel(profile.zoneType) }}</strong>
          <span>{{ waterNeedLabel(profile.waterNeedLevel) }}</span>
        </div>
        <div class="area-profile-compact-chips">
          <span *ngFor="let item of profileSummary()">{{ item }}</span>
        </div>
      </div>

      <div class="area-facts">
        <div><span>Nächster Lauf</span><strong>{{ area.next_watering_at ? (area.next_watering_at | date: 'short') : 'Noch keiner geplant' }}</strong></div>
        <div><span>Letzter Lauf</span><strong>{{ area.last_watering_at ? (area.last_watering_at | date: 'short') : 'Noch keiner' }}</strong></div>
        <div><span>Wetter</span><app-weather-decision-badge [overview]="area.weather_snapshot" [weatherEnabled]="area.weather_enabled" [decision]="area.weather_decision" /></div>
        <div *ngIf="expertMode"><span>Hardware-Ausgang</span><strong>{{ area.last_known_gpio_state ? 'an' : 'aus' }}</strong></div>
      </div>

      <div class="weather-inline-summary" *ngIf="area.weather_snapshot">
        <strong>{{ area.weather_snapshot.headline }}</strong>
        <p>{{ area.weather_snapshot.reason_human }}</p>
      </div>

      <app-manual-run-control
        [duration]="selectedMinutes"
        [maxMinutes]="area.max_duration_minutes"
        [disabled]="manualDisabled"
        [disabledReason]="manualDisabledReason"
        [running]="area.running"
        [runState]="area.run_state"
        [runningLabel]="runningLabel"
        [remainingSeconds]="area.current_run_remaining_seconds ?? null"
        (durationChange)="selectedMinutesChange.emit($event)"
        (start)="start.emit()"
        (stop)="stop.emit()"
      />

      <div class="toolbar area-toolbar">
        <button class="button secondary" type="button" (click)="editSchedule.emit(area.id)">Plan ändern</button>
        <button class="button secondary" type="button" (click)="editArea.emit()">Bereich bearbeiten</button>
      </div>

      <app-expert-section [enabled]="expertMode" title="Technische und fachliche Details">
        <app-weather-analysis-panel *ngIf="area.weather_snapshot" [overview]="area.weather_snapshot" />
        <div class="expert-grid" *ngIf="area.irrigation_profile as profile">
          <div>Regen zählt: {{ rainEffectiveness(profile.rainEffectiveness) }} ({{ profile.rainEffectiveness | number: '1.1-1' }})</div>
          <div>Hitzereaktion: {{ sensitivity(profile.temperatureSensitivity) }} ({{ profile.temperatureSensitivity | number: '1.1-1' }})</div>
          <div>Sonnenreaktion: {{ sensitivity(profile.sunSensitivity) }} ({{ profile.sunSensitivity | number: '1.1-1' }})</div>
          <div>Gefäßfaktor: {{ containerLabel(profile.containerFactor) }} ({{ profile.containerFactor | number: '1.1-1' }})</div>
          <div>Basiswasserbedarf: {{ profile.baseWaterNeedMmPerDay | number: '1.1-1' }} mm/Tag</div>
          <div>Bevorzugte Bewässerung: {{ profile.preferredTimeWindow }}</div>
        </div>
        <div class="expert-grid">
          <div>GPIO-Chip: {{ area.gpio_chip }}</div>
          <div>GPIO-Line: {{ area.gpio_line }}</div>
          <div>Ausgang zuletzt geändert: {{ area.last_gpio_changed_at ? (area.last_gpio_changed_at | date: 'short') : 'noch nie' }}</div>
          <div>Maximale Laufzeit: {{ area.max_duration_minutes }} Minuten</div>
        </div>
      </app-expert-section>
    </article>
  `,
})
export class AreaCardComponent {
  @Input({ required: true }) area!: Zone;
  @Input() status: 'disabled' | 'active' | 'watering' | 'scheduled-soon' | 'paused' | 'error' = 'active';
  @Input() selectedMinutes = 5;
  @Input() manualDisabled = false;
  @Input() manualDisabledReason = '';
  @Input() expertMode = false;
  @Input() runningLabel = '';
  @Output() selectedMinutesChange = new EventEmitter<number>();
  @Output() start = new EventEmitter<void>();
  @Output() stop = new EventEmitter<void>();
  @Output() editSchedule = new EventEmitter<number>();
  @Output() editArea = new EventEmitter<void>();

  profileSummary(): string[] {
    return buildZoneProfileSummary(this.area.irrigation_profile);
  }

  zoneTypeLabel(value: ZoneIrrigationProfile['zoneType']): string {
    return ZONE_TYPE_LABELS[value];
  }

  waterNeedLabel(value: ZoneIrrigationProfile['waterNeedLevel']): string {
    return WATER_NEED_LABELS[value];
  }

  rainEffectiveness(value: number): string {
    return rainEffectivenessLabel(value);
  }

  sensitivity(value: number): string {
    return sensitivityLabel(value);
  }

  containerLabel(value: number): string {
    return containerFactorLabel(value);
  }
}
