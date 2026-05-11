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
});
