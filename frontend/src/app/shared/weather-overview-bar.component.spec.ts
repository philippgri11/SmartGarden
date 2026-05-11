import { describe, expect, it } from 'vitest';

import { WeatherOverviewBarComponent } from './weather-overview-bar.component';

describe('WeatherOverviewBarComponent', () => {
  it('builds a compact german fact line', () => {
    const component = new WeatherOverviewBarComponent();
    component.overview = {
      weather_enabled: true,
      decision: 'skip',
      headline: 'Regen erwartet',
      summary_text: 'Automatische Bewässerung wird übersprungen.',
      forecast_window_hours: 6,
      precipitation_probability_max: 80,
      precipitation_sum_mm: 3.2,
      probability_threshold: 70,
      precipitation_threshold_mm: 2,
      fail_mode: 'deny',
      source_status: 'fresh',
      checked_at: '2026-05-11T10:00:00Z',
      reason_human: 'Regen erwartet.',
    };

    expect(component.factLine).toContain('Nächste 6 Std.');
    expect(component.factLine).toContain('80 %');
    expect(component.factLine).toContain('3,2 mm');
    expect(component.icon).toBe('☔');
  });

  it('uses the current weather code for the icon when available', () => {
    const component = new WeatherOverviewBarComponent();
    component.overview = {
      weather_enabled: true,
      decision: 'allow',
      headline: 'Bewässerung wetterseitig möglich',
      summary_text: 'Kein kritischer Regen erwartet.',
      current_condition_label: 'Sonnig',
      current_weather_code: 0,
      current_is_day: true,
      current_temperature_c: 22.4,
      forecast_window_hours: 6,
      precipitation_probability_max: 20,
      precipitation_sum_mm: 0,
      probability_threshold: 70,
      precipitation_threshold_mm: 2,
      fail_mode: 'allow',
      source_status: 'fresh',
      checked_at: '2026-05-11T10:00:00Z',
      reason_human: 'Kein kritischer Regen erwartet.',
    };

    expect(component.icon).toBe('☀️');
  });
});
