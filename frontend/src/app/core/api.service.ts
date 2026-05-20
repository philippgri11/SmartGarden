import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  AppSettings,
  GardenMap,
  GardenMapView,
  GpioEvent,
  IrrigationProjection,
  PauseSystemPayload,
  RunAllAreasResponse,
  RuntimeSnapshot,
  Schedule,
  SystemSummary,
  SystemPodsResponse,
  WateringRun,
  WinterModePayload,
  Zone,
  ZoneAdaptivePlanRequest,
  ZoneAdaptivePlanResponse,
  ZoneAssistantTranscriptionResponse,
  ZoneMapShape,
  ZoneProfileAdjustmentRequest,
  ZoneProfileSuggestionRequest,
  ZoneProfileSuggestionResponse
} from './api.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = this.resolveBaseUrl();

  getZones(): Observable<Zone[]> {
    return this.http.get<Zone[]>(`${this.baseUrl}/zones`);
  }

  createZone(payload: Partial<Zone>): Observable<Zone> {
    return this.http.post<Zone>(`${this.baseUrl}/zones`, payload);
  }

  updateZone(id: number, payload: Partial<Zone>): Observable<Zone> {
    return this.http.put<Zone>(`${this.baseUrl}/zones/${id}`, payload);
  }

  suggestZoneProfile(payload: ZoneProfileSuggestionRequest): Observable<ZoneProfileSuggestionResponse> {
    return this.http.post<ZoneProfileSuggestionResponse>(`${this.baseUrl}/zones/assistant/suggest`, payload);
  }

  adjustZoneProfile(id: number, payload: ZoneProfileAdjustmentRequest): Observable<ZoneProfileSuggestionResponse> {
    return this.http.post<ZoneProfileSuggestionResponse>(`${this.baseUrl}/zones/${id}/assistant/adjust`, payload);
  }

  suggestAdaptivePlan(payload: ZoneAdaptivePlanRequest): Observable<ZoneAdaptivePlanResponse> {
    return this.http.post<ZoneAdaptivePlanResponse>(`${this.baseUrl}/zones/assistant/adaptive-plan`, payload);
  }

  transcribeZoneAudio(payload: { audio_base64: string; filename: string; mime_type: string }): Observable<ZoneAssistantTranscriptionResponse> {
    return this.http.post<ZoneAssistantTranscriptionResponse>(`${this.baseUrl}/zones/assistant/transcribe`, payload);
  }

  deleteZone(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/zones/${id}`);
  }

  startZone(id: number, durationMinutes: number): Observable<{ message: string; run_id: number }> {
    return this.http.post<{ message: string; run_id: number }>(`${this.baseUrl}/zones/${id}/start`, {
      duration_minutes: durationMinutes
    });
  }

  stopZone(id: number): Observable<{ stops_requested: number }> {
    return this.http.post<{ stops_requested: number }>(`${this.baseUrl}/zones/${id}/stop`, {});
  }

  stopAll(): Observable<{ stops_requested: number }> {
    return this.http.post<{ stops_requested: number }>(`${this.baseUrl}/watering/stop-all`, {});
  }

  runAllAreas(): Observable<RunAllAreasResponse> {
    return this.http.post<RunAllAreasResponse>(`${this.baseUrl}/watering/run-all`, {});
  }

  releaseSafetyStop(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/system/release-safety-stop`, {});
  }

  pauseSystem(payload: PauseSystemPayload): Observable<AppSettings> {
    return this.http.post<AppSettings>(`${this.baseUrl}/system/pause`, payload);
  }

  clearPause(): Observable<AppSettings> {
    return this.http.post<AppSettings>(`${this.baseUrl}/system/clear-pause`, {});
  }

  updateWinterMode(payload: WinterModePayload): Observable<AppSettings> {
    return this.http.post<AppSettings>(`${this.baseUrl}/system/winter-mode`, payload);
  }

  getSystemSummary(): Observable<SystemSummary> {
    return this.http.get<SystemSummary>(`${this.baseUrl}/system/summary`);
  }

  getSystemPods(): Observable<SystemPodsResponse> {
    return this.http.get<SystemPodsResponse>(`${this.baseUrl}/system/pods`);
  }

  getRuntimeSnapshot(): Observable<RuntimeSnapshot> {
    return this.http.get<RuntimeSnapshot>(`${this.baseUrl}/runtime`);
  }

  getSchedules(): Observable<Schedule[]> {
    return this.http.get<Schedule[]>(`${this.baseUrl}/schedules`);
  }

  getIrrigationProjection(days = 7): Observable<IrrigationProjection> {
    return this.http.get<IrrigationProjection>(`${this.baseUrl}/schedules/projection`, { params: { days } });
  }

  createSchedule(payload: Partial<Schedule>): Observable<Schedule> {
    return this.http.post<Schedule>(`${this.baseUrl}/schedules`, payload);
  }

  updateSchedule(id: number, payload: Partial<Schedule>): Observable<Schedule> {
    return this.http.put<Schedule>(`${this.baseUrl}/schedules/${id}`, payload);
  }

  deleteSchedule(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/schedules/${id}`);
  }

  getRuns(): Observable<WateringRun[]> {
    return this.http.get<WateringRun[]>(`${this.baseUrl}/watering/runs`);
  }

  getSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>(`${this.baseUrl}/settings`);
  }

  updateSettings(payload: AppSettings): Observable<AppSettings> {
    return this.http.put<AppSettings>(`${this.baseUrl}/settings`, payload);
  }

  getGpioEvents(): Observable<GpioEvent[]> {
    return this.http.get<GpioEvent[]>(`${this.baseUrl}/gpio/events`);
  }

  getMaps(): Observable<GardenMap[]> {
    return this.http.get<GardenMap[]>(`${this.baseUrl}/maps`);
  }

  createMap(payload: Partial<GardenMap>): Observable<GardenMap> {
    return this.http.post<GardenMap>(`${this.baseUrl}/maps`, payload);
  }

  updateMap(id: number, payload: Partial<GardenMap>): Observable<GardenMap> {
    return this.http.put<GardenMap>(`${this.baseUrl}/maps/${id}`, payload);
  }

  deleteMap(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/maps/${id}`);
  }

  getMapView(id: number): Observable<GardenMapView> {
    return this.http.get<GardenMapView>(`${this.baseUrl}/maps/${id}/view`);
  }

  createMapShape(payload: Partial<ZoneMapShape>): Observable<ZoneMapShape> {
    return this.http.post<ZoneMapShape>(`${this.baseUrl}/maps/shapes`, payload);
  }

  updateMapShape(id: number, payload: Partial<ZoneMapShape>): Observable<ZoneMapShape> {
    return this.http.put<ZoneMapShape>(`${this.baseUrl}/maps/shapes/${id}`, payload);
  }

  deleteMapShape(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/maps/shapes/${id}`);
  }

  private resolveBaseUrl(): string {
    if (['smartgarden.gloriaundphilipp.de', 'mach-nass.de'].includes(globalThis.location?.hostname)) {
      return '/api';
    }

    const config = (globalThis as typeof globalThis & {
      __SMARTGARDEN_CONFIG__?: { apiBaseUrl?: string };
    }).__SMARTGARDEN_CONFIG__;
    return config?.apiBaseUrl || '/api';
  }
}
