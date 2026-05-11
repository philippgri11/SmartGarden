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
        <div><span>Grenze</span><strong>{{ overview.probability_threshold }} % · {{ thresholdPrecipitationText }}</strong></div>
        <div><span>Wenn Daten fehlen</span><strong>{{ failModeText }}</strong></div>
        <div><span>Entscheidung</span><strong>{{ overview.reason_human }}</strong></div>
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

  get failModeText(): string {
    return this.overview.fail_mode === 'deny' ? 'Nicht bewässern' : 'Trotzdem bewässern';
  }
}
