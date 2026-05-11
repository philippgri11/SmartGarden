import { CommonModule, DatePipe, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

import { WeatherOverview } from '../core/api.models';

@Component({
  selector: 'app-weather-overview-bar',
  standalone: true,
  imports: [CommonModule, DatePipe, NgClass],
  template: `
    <section class="weather-overview-bar" [ngClass]="'weather-bar-' + overview.decision">
      <div class="weather-overview-icon" aria-hidden="true">{{ icon }}</div>
      <div class="weather-overview-copy">
        <strong>{{ overview.headline }}</strong>
        <p>{{ overview.summary_text }}</p>
        <small>
          {{ factLine }}
          <span *ngIf="overview.checked_at"> · geprüft {{ overview.checked_at | date: 'short' }}</span>
        </small>
      </div>
    </section>
  `,
})
export class WeatherOverviewBarComponent {
  @Input({ required: true }) overview!: WeatherOverview;

  get icon(): string {
    const code = this.overview.current_weather_code;
    const isDay = this.overview.current_is_day !== false;

    if (code === null || code === undefined) {
      switch (this.overview.decision) {
        case 'skip':
          return '☔';
        case 'error':
          return '⚠';
        case 'inactive':
          return '○';
        case 'allow':
          return '⛅';
        default:
          return '…';
      }
    }

    if (code === 0) {
      return isDay ? '☀️' : '🌙';
    }
    if (code === 1 || code === 2) {
      return isDay ? '🌤️' : '☁️';
    }
    if (code === 3) {
      return '☁️';
    }
    if (code === 45 || code === 48) {
      return '🌫️';
    }
    if ([51, 53, 55, 56, 57].includes(code)) {
      return '🌦️';
    }
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
      return '🌧️';
    }
    if ([71, 73, 75, 77, 85, 86].includes(code)) {
      return '🌨️';
    }
    if ([95, 96, 99].includes(code)) {
      return '⛈️';
    }
    return '⛅';
  }

  get factLine(): string {
    if (!this.overview.weather_enabled) {
      return 'Wettersteuerung ist ausgeschaltet';
    }
    const probability =
      this.overview.precipitation_probability_max === null || this.overview.precipitation_probability_max === undefined
        ? 'Regenwahrscheinlichkeit unbekannt'
        : `${Math.round(this.overview.precipitation_probability_max)} % Regenwahrscheinlichkeit`;
    const precipitation =
      this.overview.precipitation_sum_mm === null || this.overview.precipitation_sum_mm === undefined
        ? 'Niederschlag unbekannt'
        : `${this.overview.precipitation_sum_mm.toFixed(1).replace('.', ',')} mm`;
    return `Nächste ${this.overview.forecast_window_hours} Std.: ${probability} · ${precipitation}`;
  }
}
