import { describe, expect, it } from 'vitest';

import { WeatherOverview } from '../core/api.models';
import { WeatherOverviewBarComponent } from './weather-overview-bar.component';

const baseOverview: WeatherOverview = {
  weather_enabled: true,
  decision: 'allow',
  headline: 'Wetter ok',
  summary_text: 'Bewässerung kann laufen.',
  forecast_window_hours: 6,
  precipitation_probability_max: 47.6,
  precipitation_sum_mm: 1.25,
  probability_threshold: 70,
  precipitation_threshold_mm: 2,
  fail_mode: 'allow',
  source_status: 'fresh',
  reason_human: 'Trocken genug.',
};

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
      ...baseOverview,
      headline: 'Bewässerung wetterseitig möglich',
      summary_text: 'Kein kritischer Regen erwartet.',
      current_condition_label: 'Sonnig',
      current_weather_code: 0,
      current_is_day: true,
      current_temperature_c: 22.4,
      precipitation_probability_max: 20,
      precipitation_sum_mm: 0,
      checked_at: '2026-05-11T10:00:00Z',
      reason_human: 'Kein kritischer Regen erwartet.',
    };

    expect(component.icon).toBe('☀️');
  });

  it('explains disabled and unavailable weather states', () => {
    const component = new WeatherOverviewBarComponent();

    component.overview = { ...baseOverview, weather_enabled: false };
    expect(component.factLine).toBe('Wettersteuerung ist ausgeschaltet');

    component.overview = { ...baseOverview, source_status: 'unavailable' };
    expect(component.factLine).toBe('Wetterdaten konnten wegen eines API-Fehlers nicht abgerufen werden');
  });

  it('chooses icons from weather code families and fallback decisions', () => {
    const component = new WeatherOverviewBarComponent();

    component.overview = { ...baseOverview, current_weather_code: undefined, decision: 'error' };
    expect(component.icon).toBe('⚠');
    component.overview = { ...baseOverview, current_weather_code: undefined, decision: 'inactive' };
    expect(component.icon).toBe('○');
    component.overview = { ...baseOverview, current_weather_code: undefined, decision: 'unknown' };
    expect(component.icon).toBe('…');
    component.overview = { ...baseOverview, current_weather_code: 0, current_is_day: false };
    expect(component.icon).toBe('🌙');
    component.overview = { ...baseOverview, current_weather_code: 2, current_is_day: true };
    expect(component.icon).toBe('🌤️');
    component.overview = { ...baseOverview, current_weather_code: 45 };
    expect(component.icon).toBe('🌫️');
    component.overview = { ...baseOverview, current_weather_code: 53 };
    expect(component.icon).toBe('🌦️');
    component.overview = { ...baseOverview, current_weather_code: 63 };
    expect(component.icon).toBe('🌧️');
    component.overview = { ...baseOverview, current_weather_code: 75 };
    expect(component.icon).toBe('🌨️');
    component.overview = { ...baseOverview, current_weather_code: 95 };
    expect(component.icon).toBe('⛈️');
  });
});
