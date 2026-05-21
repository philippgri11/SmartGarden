import { describe, expect, it, vi } from 'vitest';

import { ApiService } from './api.service';

type HttpCall = { method: string; url: string; body?: unknown; options?: unknown };

function createApiService(baseUrl = '/api'): { service: ApiService; calls: HttpCall[] } {
  const calls: HttpCall[] = [];
  const http = {
    get: vi.fn((url: string, options?: unknown) => {
      calls.push({ method: 'get', url, options });
      return { method: 'get', url, options };
    }),
    post: vi.fn((url: string, body: unknown, options?: unknown) => {
      calls.push({ method: 'post', url, body, options });
      return { method: 'post', url, body, options };
    }),
    put: vi.fn((url: string, body: unknown, options?: unknown) => {
      calls.push({ method: 'put', url, body, options });
      return { method: 'put', url, body, options };
    }),
    delete: vi.fn((url: string, options?: unknown) => {
      calls.push({ method: 'delete', url, options });
      return { method: 'delete', url, options };
    }),
  };
  const service = Object.create(ApiService.prototype) as ApiService & {
    http: typeof http;
    baseUrl: string;
  };
  service.http = http;
  service.baseUrl = baseUrl;
  return { service, calls };
}

describe('ApiService', () => {
  it('routes zone and watering methods to the expected API endpoints', () => {
    const { service, calls } = createApiService();
    const payload = { name: 'Hochbeet' };

    service.getZones();
    service.createZone(payload);
    service.updateZone(7, payload);
    service.suggestZoneProfile({ description: 'sonnig' });
    service.adjustZoneProfile(7, { instruction: 'mehr Sonne' });
    service.suggestAdaptivePlan({ profile: {} as never, max_duration_minutes: 20 });
    service.transcribeZoneAudio({ audio_base64: 'abc', filename: 'note.webm', mime_type: 'audio/webm' });
    service.deleteZone(7);
    service.startZone(7, 12);
    service.stopZone(7);
    service.stopAll();
    service.runAllAreas();

    expect(calls).toMatchObject([
      { method: 'get', url: '/api/zones' },
      { method: 'post', url: '/api/zones', body: payload },
      { method: 'put', url: '/api/zones/7', body: payload },
      { method: 'post', url: '/api/zones/assistant/suggest' },
      { method: 'post', url: '/api/zones/7/assistant/adjust' },
      { method: 'post', url: '/api/zones/assistant/adaptive-plan' },
      { method: 'post', url: '/api/zones/assistant/transcribe' },
      { method: 'delete', url: '/api/zones/7' },
      { method: 'post', url: '/api/zones/7/start', body: { duration_minutes: 12 } },
      { method: 'post', url: '/api/zones/7/stop', body: {} },
      { method: 'post', url: '/api/watering/stop-all', body: {} },
      { method: 'post', url: '/api/watering/run-all', body: {} },
    ]);
  });

  it('routes system, schedule and history methods to the expected API endpoints', () => {
    const { service, calls } = createApiService('/custom-api');
    const settings = { location_name: 'Garten' } as never;
    const schedule = { zone_id: 1, duration_minutes: 10 } as never;

    service.releaseSafetyStop();
    service.pauseSystem({ hours: 24 });
    service.clearPause();
    service.updateWinterMode({ active: true, disable_manual_start: true, pause_schedules: true, safety_shutdown: true });
    service.getSystemSummary();
    service.getSystemPods();
    service.getRuntimeSnapshot();
    service.getSchedules();
    service.getIrrigationProjection();
    service.getIrrigationProjection(14);
    service.createSchedule(schedule);
    service.updateSchedule(9, schedule);
    service.deleteSchedule(9);
    service.getRuns();
    service.getSettings();
    service.updateSettings(settings);
    service.getGpioEvents();

    expect(calls).toMatchObject([
      { method: 'post', url: '/custom-api/system/release-safety-stop', body: {} },
      { method: 'post', url: '/custom-api/system/pause', body: { hours: 24 } },
      { method: 'post', url: '/custom-api/system/clear-pause', body: {} },
      { method: 'post', url: '/custom-api/system/winter-mode' },
      { method: 'get', url: '/custom-api/system/summary' },
      { method: 'get', url: '/custom-api/system/pods' },
      { method: 'get', url: '/custom-api/runtime' },
      { method: 'get', url: '/custom-api/schedules' },
      { method: 'get', url: '/custom-api/schedules/projection', options: { params: { days: 7 } } },
      { method: 'get', url: '/custom-api/schedules/projection', options: { params: { days: 14 } } },
      { method: 'post', url: '/custom-api/schedules', body: schedule },
      { method: 'put', url: '/custom-api/schedules/9', body: schedule },
      { method: 'delete', url: '/custom-api/schedules/9' },
      { method: 'get', url: '/custom-api/watering/runs' },
      { method: 'get', url: '/custom-api/settings' },
      { method: 'put', url: '/custom-api/settings', body: settings },
      { method: 'get', url: '/custom-api/gpio/events' },
    ]);
  });

  it('routes map methods to the expected API endpoints', () => {
    const { service, calls } = createApiService();
    const mapPayload = { name: 'Gartenkarte' };
    const shapePayload = { name: 'Hochbeet Flaeche' };

    service.getMaps();
    service.createMap(mapPayload);
    service.updateMap(3, mapPayload);
    service.deleteMap(3);
    service.getMapView(3);
    service.createMapShape(shapePayload);
    service.updateMapShape(11, shapePayload);
    service.deleteMapShape(11);

    expect(calls).toMatchObject([
      { method: 'get', url: '/api/maps' },
      { method: 'post', url: '/api/maps', body: mapPayload },
      { method: 'put', url: '/api/maps/3', body: mapPayload },
      { method: 'delete', url: '/api/maps/3' },
      { method: 'get', url: '/api/maps/3/view' },
      { method: 'post', url: '/api/maps/shapes', body: shapePayload },
      { method: 'put', url: '/api/maps/shapes/11', body: shapePayload },
      { method: 'delete', url: '/api/maps/shapes/11' },
    ]);
  });

  it('uses the deployed same-origin API base URL for known remote hosts', () => {
    const service = Object.create(ApiService.prototype) as ApiService & {
      resolveBaseUrl: () => string;
    };
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: 'mach-nass.de' },
    });

    expect(service.resolveBaseUrl()).toBe('/api');

    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('uses runtime config or /api as local API base URL', () => {
    const service = Object.create(ApiService.prototype) as ApiService & {
      resolveBaseUrl: () => string;
    };
    const originalLocation = globalThis.location;
    const originalConfig = (globalThis as typeof globalThis & {
      __SMARTGARDEN_CONFIG__?: { apiBaseUrl?: string };
    }).__SMARTGARDEN_CONFIG__;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: 'localhost' },
    });

    (globalThis as typeof globalThis & { __SMARTGARDEN_CONFIG__?: { apiBaseUrl?: string } }).__SMARTGARDEN_CONFIG__ = {
      apiBaseUrl: 'http://127.0.0.1:8000/api',
    };
    expect(service.resolveBaseUrl()).toBe('http://127.0.0.1:8000/api');

    delete (globalThis as typeof globalThis & { __SMARTGARDEN_CONFIG__?: { apiBaseUrl?: string } }).__SMARTGARDEN_CONFIG__;
    expect(service.resolveBaseUrl()).toBe('/api');

    if (originalConfig) {
      (globalThis as typeof globalThis & { __SMARTGARDEN_CONFIG__?: { apiBaseUrl?: string } }).__SMARTGARDEN_CONFIG__ = originalConfig;
    }
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });
});
