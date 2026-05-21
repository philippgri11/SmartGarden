import { describe, expect, it } from 'vitest';

import { WeatherDecisionBadgeComponent } from './weather-decision-badge.component';

describe('WeatherDecisionBadgeComponent', () => {
  it('shows a clear skip label in German', () => {
    const component = new WeatherDecisionBadgeComponent();
    component.weatherEnabled = true;
    component.decision = 'skip';

    expect(component.label).toBe('Regen erwartet');
    expect(component.variantClass).toBe('weather-skip');
  });

  it('shows disabled weather as off', () => {
    const component = new WeatherDecisionBadgeComponent();
    component.weatherEnabled = false;

    expect(component.label).toBe('Wetter aus');
    expect(component.variantClass).toBe('weather-off');
  });

  it('prefers overview data over loose inputs', () => {
    const component = new WeatherDecisionBadgeComponent();
    component.weatherEnabled = false;
    component.decision = 'skip';
    component.overview = {
      weather_enabled: true,
      decision: 'allow',
      headline: 'Trocken genug',
      summary_text: 'Bewässerung ist sinnvoll.',
      forecast_window_hours: 6,
      probability_threshold: 70,
      precipitation_threshold_mm: 2,
      fail_mode: 'allow',
      source_status: 'fresh',
      reason_human: 'Keine relevante Regenmenge.',
    };

    expect(component.label).toBe('Wetter ok');
    expect(component.variantClass).toBe('weather-on');
  });

  it('marks unavailable weather data as an error', () => {
    const component = new WeatherDecisionBadgeComponent();
    component.weatherEnabled = true;
    component.decision = 'allow';
    component.overview = {
      weather_enabled: true,
      decision: 'unknown',
      headline: 'Keine Daten',
      summary_text: 'Wetterdienst nicht erreichbar.',
      forecast_window_hours: 6,
      probability_threshold: 70,
      precipitation_threshold_mm: 2,
      fail_mode: 'deny',
      source_status: 'unavailable',
      reason_human: 'API nicht erreichbar.',
    };

    expect(component.label).toBe('Wetterdaten fehlen');
    expect(component.variantClass).toBe('weather-error');
  });
});
