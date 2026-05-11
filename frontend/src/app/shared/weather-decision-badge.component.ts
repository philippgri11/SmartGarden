import { CommonModule, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

import { WeatherOverview } from '../core/api.models';

@Component({
  selector: 'app-weather-decision-badge',
  standalone: true,
  imports: [CommonModule, NgClass],
  template: `
    <span class="weather-chip" [ngClass]="variantClass">
      {{ label }}
    </span>
  `,
})
export class WeatherDecisionBadgeComponent {
  @Input() weatherEnabled = false;
  @Input() decision?: string | null;
  @Input() overview?: WeatherOverview | null;

  get label(): string {
    const decision = this.overview?.decision ?? this.decision;
    const weatherEnabled = this.overview?.weather_enabled ?? this.weatherEnabled;
    if (!weatherEnabled || decision === 'inactive') {
      return 'Wetter aus';
    }
    if (decision === 'skip') {
      return 'Regen erwartet';
    }
    if (decision === 'error') {
      return 'Wetterdaten fehlen';
    }
    if (decision === 'allow') {
      return 'Wetter ok';
    }
    return 'Wetter wird geprüft';
  }

  get variantClass(): string {
    const decision = this.overview?.decision ?? this.decision;
    const weatherEnabled = this.overview?.weather_enabled ?? this.weatherEnabled;
    if (!weatherEnabled || decision === 'inactive') {
      return 'weather-off';
    }
    if (decision === 'skip') {
      return 'weather-skip';
    }
    if (decision === 'error') {
      return 'weather-error';
    }
    return 'weather-on';
  }
}
