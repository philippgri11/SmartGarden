import { CommonModule, DatePipe } from '@angular/common';
import { Component, Input } from '@angular/core';

import { WeatherOverview } from '../core/api.models';

@Component({
  selector: 'app-weather-analysis-panel',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    <div class="weather-analysis-panel">
      <div class="weather-analysis-grid">
        <div><span>Geprüft am</span><strong>{{ overview.checked_at ? (overview.checked_at | date: 'short') : 'Noch keine Prüfung' }}</strong></div>
        <div><span>Betrachtungszeitraum</span><strong>{{ overview.forecast_window_hours }} Stunden</strong></div>
        <div><span>Prognose</span><strong>{{ probabilityText }} · {{ precipitationText }}</strong></div>
        <div><span>Tageshöchstwert</span><strong>{{ maxTemperatureText }}</strong></div>
        <div><span>Regen letzte 24h</span><strong>{{ lastRainText }}</strong></div>
        <div><span>Regen nächste 24h</span><strong>{{ nextRainText }}</strong></div>
        <div><span>Bewölkung</span><strong>{{ cloudText }}</strong></div>
        <div><span>Grenze</span><strong>{{ overview.probability_threshold }} % · {{ thresholdPrecipitationText }}</strong></div>
        <div><span>Wenn Daten fehlen</span><strong>{{ failModeText }}</strong></div>
        <div><span>Entscheidung</span><strong>{{ overview.reason_human }}</strong></div>
      </div>
      <div class="irrigation-explanation" *ngIf="overview.irrigation_recommendation as recommendation">
        <strong>Profilbasierte Laufzeit</strong>
        <p>{{ recommendation.explanation }}</p>
        <div class="weather-analysis-grid">
          <div><span>Geplant</span><strong>{{ recommendation.scheduled_duration_minutes }} min</strong></div>
          <div><span>Ausgeführt</span><strong>{{ recommendation.decision === 'skip' ? 'übersprungen' : recommendation.adjusted_duration_minutes + ' min' }}</strong></div>
          <div><span>Geschätzter Bedarf</span><strong>{{ formatMm(recommendation.estimated_need_mm) }}</strong></div>
          <div><span>Wirksamer Regen</span><strong>{{ formatMm(recommendation.effective_rain_mm) }}</strong></div>
          <div><span>Netto-Bedarf</span><strong>{{ formatMm(recommendation.net_need_mm) }}</strong></div>
          <div><span>Laufzeitfaktor</span><strong>{{ recommendation.multiplier | number: '1.2-2' }}</strong></div>
        </div>
        <ul>
          <li *ngFor="let detail of recommendation.details">{{ detail }}</li>
        </ul>
      </div>
    </div>
  `,
})
export class WeatherAnalysisPanelComponent {
  @Input({ required: true }) overview!: WeatherOverview;

  get probabilityText(): string {
    if (this.overview.precipitation_probability_max === null || this.overview.precipitation_probability_max === undefined) {
      return 'unbekannt';
    }
    return `${Math.round(this.overview.precipitation_probability_max)} %`;
  }

  get precipitationText(): string {
    if (this.overview.precipitation_sum_mm === null || this.overview.precipitation_sum_mm === undefined) {
      return 'unbekannt';
    }
    return `${this.overview.precipitation_sum_mm.toFixed(1).replace('.', ',')} mm`;
  }

  get thresholdPrecipitationText(): string {
    return `${this.overview.precipitation_threshold_mm.toFixed(1).replace('.', ',')} mm`;
  }

  get maxTemperatureText(): string {
    if (this.overview.temperature_max_24h_c === null || this.overview.temperature_max_24h_c === undefined) {
      return this.overview.current_temperature_c === null || this.overview.current_temperature_c === undefined ? 'unbekannt' : `${this.overview.current_temperature_c.toFixed(1).replace('.', ',')} °C aktuell`;
    }
    return `${this.overview.temperature_max_24h_c.toFixed(1).replace('.', ',')} °C`;
  }

  get lastRainText(): string {
    return this.formatNullableMm(this.overview.precipitation_last_24h_mm);
  }

  get nextRainText(): string {
    return this.formatNullableMm(this.overview.precipitation_next_24h_mm);
  }

  get cloudText(): string {
    if (this.overview.cloud_cover_avg_pct === null || this.overview.cloud_cover_avg_pct === undefined) {
      return 'unbekannt';
    }
    return `${Math.round(this.overview.cloud_cover_avg_pct)} %`;
  }

  get failModeText(): string {
    return this.overview.fail_mode === 'deny' ? 'Nicht bewässern' : 'Trotzdem bewässern';
  }

  formatMm(value: number): string {
    return `${value.toFixed(1).replace('.', ',')} mm`;
  }

  private formatNullableMm(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return 'unbekannt';
    }
    return this.formatMm(value);
  }
}
