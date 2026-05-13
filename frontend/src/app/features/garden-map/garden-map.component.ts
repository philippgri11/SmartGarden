import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { combineLatest, finalize, forkJoin, map, of, startWith, Subject, switchMap } from 'rxjs';
import * as L from 'leaflet';
import 'leaflet-draw';

import { ApiService } from '../../core/api.service';
import { GardenMap, GardenMapView, ZoneMapShapeView } from '../../core/api.models';
import { UiPreferencesService } from '../../core/ui-preferences.service';
import { AreaStatusBadgeComponent } from '../../shared/area-status-badge.component';
import { ExpertSectionComponent } from '../../shared/expert-section.component';
import { ManualRunControlComponent } from '../../shared/manual-run-control.component';
import { WeatherAnalysisPanelComponent } from '../../shared/weather-analysis-panel.component';
import { WeatherDecisionBadgeComponent } from '../../shared/weather-decision-badge.component';
import { RuntimeFacade } from '../../state/runtime/runtime.facade';

type LeafletLayer = L.Layer & { toGeoJSON: () => GeoJSON.Feature<GeoJSON.Geometry> };

@Component({
  standalone: true,
  selector: 'app-garden-map',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DatePipe,
    AreaStatusBadgeComponent,
    ExpertSectionComponent,
    ManualRunControlComponent,
    WeatherDecisionBadgeComponent,
    WeatherAnalysisPanelComponent,
  ],
  template: `
    <section class="page-title">
      <h2>Gartenkarte</h2>
      <p>Dein Gartenbild wird zur visuellen Steuerzentrale für alle Bereiche.</p>
    </section>

    <ng-container *ngIf="vm$ | async as vm">
      <div
        class="map-layout smart-map-layout"
        [class.map-layout-left-collapsed]="!showMapEditor()"
        [class.map-layout-right-collapsed]="!showMapDetails()"
      >
        <div class="map-sidebar" *ngIf="showMapEditor()">
          <section class="panel">
            <h3>Karte verwalten</h3>
            <form [formGroup]="mapForm" class="form-grid form-grid-balanced" (ngSubmit)="saveMap()">
              <label class="field field-full">
                <span>Name der Karte</span>
                <input formControlName="name" />
              </label>
              <label class="field field-full">
                <span>Gartenbild hochladen</span>
                <input type="file" accept="image/*" (change)="onImageSelected($event)" />
              </label>

              <app-expert-section [enabled]="expertMode()" title="Expertenoptionen">
                <div class="form-grid form-grid-balanced">
                  <label class="field field-span-4">
                    <span>Bild-URL</span>
                    <input formControlName="image_url" />
                  </label>
                  <label class="field field-span-2">
                    <span>Breite</span>
                    <input type="number" formControlName="width" />
                  </label>
                  <label class="field field-span-2">
                    <span>Höhe</span>
                    <input type="number" formControlName="height" />
                  </label>
                </div>
              </app-expert-section>

              <div class="toolbar field-full">
                <button class="button" type="submit" [disabled]="mapForm.invalid || isSavingMap()">{{ selectedMap() ? 'Karte speichern' : 'Karte anlegen' }}</button>
                <button class="button secondary" type="button" (click)="resetMapForm()">Zurücksetzen</button>
              </div>
              <p class="notice success" *ngIf="mapFeedback()">{{ mapFeedback() }}</p>
              <p class="notice error" *ngIf="mapError()">{{ mapError() }}</p>
            </form>

            <div class="field" *ngIf="vm.maps.length">
              <span>Aktive Karte</span>
              <select [formControl]="selectedMapIdControl">
                <option *ngFor="let map of vm.maps" [ngValue]="map.id">{{ map.name }}</option>
              </select>
            </div>
          </section>

          <section class="panel">
            <h3>Werkzeuge</h3>
            <p class="muted">Wähle zuerst einen bestehenden Bereich aus. Danach zeichnest du eine neue Fläche auf der Karte oder bearbeitest vorhandene Flächen direkt im Kartenwerkzeug.</p>
            <div class="toolbar wrap">
              <button class="button secondary" type="button" (click)="triggerLeafletAction('.leaflet-draw-draw-polygon')">Fläche zeichnen</button>
              <button class="button secondary" type="button" (click)="triggerLeafletAction('.leaflet-draw-edit-edit')">Bearbeiten</button>
              <button class="button secondary" type="button" (click)="triggerLeafletAction('.leaflet-draw-edit-remove')">Löschen</button>
              <button class="button secondary" type="button" (click)="reloadSelectedMap()">Rückgängig</button>
            </div>
            <label class="field">
              <span>Bestehenden Bereich für neue Fläche wählen</span>
              <select [formControl]="shapeDraftForm.controls.zone_id">
                <option [ngValue]="null">Bitte Bereich wählen</option>
                <option *ngFor="let zone of vm.areas" [ngValue]="zone.id">{{ zone.name }}</option>
              </select>
            </label>
            <label class="field">
              <span>Name der Fläche</span>
              <input [formControl]="shapeDraftForm.controls.name" />
            </label>
            <p class="notice success" *ngIf="shapeFeedback()">{{ shapeFeedback() }}</p>
            <p class="notice error" *ngIf="shapeError()">{{ shapeError() }}</p>
          </section>
        </div>

        <div class="map-toolbar-mobile">
          <div class="map-toolbar-mobile-main">
            <button class="button secondary" type="button" (click)="showMobileMapTools.set(!showMobileMapTools())">
              {{ showMobileMapTools() ? 'Werkzeuge ausblenden' : 'Werkzeuge anzeigen' }}
            </button>
            <button class="button secondary" type="button" (click)="showMapDetails.set(!showMapDetails())">
              {{ showMapDetails() ? 'Details ausblenden' : 'Details anzeigen' }}
            </button>
          </div>
          <div class="map-toolbar-mobile-tools" *ngIf="showMobileMapTools()">
            <button class="button secondary" type="button" (click)="zoomMapIn()">Zoom +</button>
            <button class="button secondary" type="button" (click)="zoomMapOut()">Zoom -</button>
            <button class="button secondary" type="button" (click)="triggerLeafletAction('.leaflet-draw-draw-polygon')">Fläche zeichnen</button>
            <button class="button secondary" type="button" (click)="triggerLeafletAction('.leaflet-draw-edit-edit')">Bearbeiten</button>
            <button class="button secondary" type="button" (click)="triggerLeafletAction('.leaflet-draw-edit-remove')">Löschen</button>
          </div>
        </div>

        <section class="map-canvas">
          <div class="map-toolbar">
            <button class="button secondary" type="button" (click)="showMapEditor.set(!showMapEditor())">
              {{ showMapEditor() ? 'Werkzeuge ausblenden' : 'Werkzeuge anzeigen' }}
            </button>
            <button class="button secondary" type="button" (click)="showMapDetails.set(!showMapDetails())">
              {{ showMapDetails() ? 'Details ausblenden' : 'Details anzeigen' }}
            </button>
          </div>
          <div class="map-legend" *ngIf="showMapLegend()">
            <strong>Legende</strong>
            <div class="map-legend-items">
              <span class="legend-chip legend-active">Aktiv</span>
              <span class="legend-chip legend-watering">Bewässert gerade</span>
              <span class="legend-chip legend-soon">Bald geplant oder pausiert</span>
              <span class="legend-chip legend-disabled">Deaktiviert</span>
              <span class="legend-chip legend-error">Fehler</span>
            </div>
          </div>
          <div #mapSurface class="map-surface"></div>
        </section>

        <section class="panel area-detail-panel" *ngIf="showMapDetails() && selectedShape(); else mapHint">
          <ng-container *ngIf="selectedShape() as shape">
            <div class="area-card-head">
              <div>
                <div class="eyebrow">Fläche</div>
                <h3>{{ displayShapeName(shape) }}</h3>
                <p class="muted">{{ shape.zone_status.name }}</p>
              </div>
              <app-area-status-badge [status]="shape.zone_status.status" />
            </div>
            <div class="detail-stack">
              <div><span>Nächste Bewässerung</span><strong>{{ shape.zone_status.next_watering_at ? (shape.zone_status.next_watering_at | date: 'short') : 'Noch kein nächster Lauf' }}</strong></div>
              <div><span>Letzter Lauf</span><strong>{{ shape.zone_status.last_watering_at ? (shape.zone_status.last_watering_at | date: 'short') : 'Noch keiner' }}</strong></div>
              <div><span>Wetterentscheidung</span><app-weather-decision-badge [overview]="shape.zone_status.weather_snapshot" [weatherEnabled]="shape.zone_status.weather_enabled" [decision]="shape.zone_status.weather_decision" /></div>
            </div>
            <div class="weather-inline-summary" *ngIf="shape.zone_status.weather_snapshot">
              <strong>{{ shape.zone_status.weather_snapshot.headline }}</strong>
              <p>{{ shape.zone_status.weather_snapshot.reason_human }}</p>
            </div>
            <app-manual-run-control
              [duration]="minutesForShape(shape)"
              [maxMinutes]="shape.zone_status.max_duration_minutes"
              [disabled]="manualDisabled(shape)"
              [disabledReason]="manualDisabledReason(shape)"
              [running]="shape.zone_status.running"
              [runState]="shape.zone_status.run_state"
              [remainingSeconds]="shape.zone_status.current_run_remaining_seconds ?? null"
              (durationChange)="setShapeMinutes(shape.id, $event, shape.zone_status.max_duration_minutes)"
              (start)="startShape(shape)"
              (stop)="stopShape(shape)"
            />
            <div class="toolbar area-toolbar">
              <button class="button secondary" type="button" (click)="openSchedules(shape.zone_id)">Zeitplan bearbeiten</button>
              <button class="button secondary" type="button" (click)="toggleAreaPause(shape)">
                {{ shape.zone_status.active ? 'Bereich pausieren' : 'Bereich aktivieren' }}
              </button>
            </div>
            <app-expert-section [enabled]="expertMode()" title="Wetteranalyse">
              <app-weather-analysis-panel *ngIf="shape.zone_status.weather_snapshot" [overview]="shape.zone_status.weather_snapshot" />
            </app-expert-section>
          </ng-container>
        </section>
        <ng-template #mapHint>
          <section class="panel area-detail-panel" *ngIf="showMapDetails()">
            <h3>Bereich wählen</h3>
            <p class="muted">Tippe auf eine Fläche, um Zustand, letzte und nächste Bewässerung sowie manuelle Aktionen zu sehen.</p>
          </section>
        </ng-template>
      </div>
    </ng-container>
  `,
})
export class GardenMapComponent implements OnInit {
  @ViewChild('mapSurface')
  set mapSurfaceRef(value: ElementRef<HTMLDivElement> | undefined) {
    if (!value || this.map) {
      return;
    }
    this.mapSurface = value;
    this.initializeMap();
    const currentView = this.currentMapView();
    if (currentView) {
      this.renderMap(currentView);
    }
  }

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly preferences = inject(UiPreferencesService);
  private readonly runtime = inject(RuntimeFacade);
  private readonly reload$ = new Subject<void>();

  readonly expertMode = computed(() => this.preferences.expertMode());
  readonly showMapEditor = signal(false);
  readonly showMapDetails = signal(true);
  readonly showMapLegend = signal(true);
  readonly showMobileMapTools = signal(false);
  readonly selectedMap = signal<GardenMap | null>(null);
  readonly selectedShape = signal<ZoneMapShapeView | null>(null);
  readonly currentMapView = signal<GardenMapView | null>(null);
  readonly isSavingMap = signal(false);
  readonly mapFeedback = signal('');
  readonly mapError = signal('');
  readonly shapeFeedback = signal('');
  readonly shapeError = signal('');
  readonly shapeMinutes = signal<Record<number, number>>({});
  readonly areaNamesById = signal<Record<number, string>>({});
  private autoShapeName = '';

  private mapSurface?: ElementRef<HTMLDivElement>;
  private map?: L.Map;
  private imageOverlay?: L.ImageOverlay;
  private readonly drawnItems = new L.FeatureGroup();
  private readonly layerByShapeId = new Map<number, L.Layer>();
  private drawControl?: L.Control;
  private pendingImageDataUrl: string | null = null;

  readonly mapForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    image_url: [''],
    width: [1600, Validators.required],
    height: [900, Validators.required],
  });

  readonly shapeDraftForm = this.fb.group({
    zone_id: this.fb.control<number | null>(null, Validators.required),
    name: this.fb.control<string>(''),
  });

  readonly selectedMapIdControl = this.fb.control<number | null>(null);

  readonly vm$ = combineLatest([
    this.runtime.vm$,
    this.reload$.pipe(
    startWith(void 0),
    switchMap(() =>
      combineLatest([
        this.api.getMaps(),
      ])
    ),
    switchMap(([maps]) => {
      const selectedMapId = this.selectedMapIdControl.value ?? this.selectedMap()?.id ?? maps.at(-1)?.id ?? null;
      if (selectedMapId === null) {
        return of({ maps, mapView: null as GardenMapView | null });
      }
      return this.api.getMapView(selectedMapId).pipe(
        map((mapView) => ({ maps, mapView }))
      );
    }),
  )]).pipe(
    map(([runtimeVm, { maps, mapView }]) => {
      const areasById = new Map(runtimeVm.areas.map((area) => [area.id, area]));
      const mergedView = mapView
        ? {
            ...mapView,
            shapes: mapView.shapes.map((shape) => ({
              ...shape,
              zone_status: {
                ...shape.zone_status,
                ...(areasById.get(shape.zone_id) ?? {}),
                zone_id: shape.zone_id,
              },
            })),
          }
        : null;
      if (mapView) {
        this.selectedMap.set(mapView.map);
        this.currentMapView.set(mergedView as GardenMapView);
        this.selectedMapIdControl.setValue(mapView.map.id, { emitEvent: false });
        this.mapForm.patchValue({
          name: mapView.map.name,
          image_url: mapView.map.image_url ?? '',
          width: mapView.map.width,
          height: mapView.map.height,
        }, { emitEvent: false });
        this.pendingImageDataUrl = mapView.map.image_url ?? null;
        this.renderMap(mergedView as GardenMapView);
      } else {
        this.selectedMap.set(null);
        this.currentMapView.set(null);
        this.selectedMapIdControl.setValue(null, { emitEvent: false });
        this.clearMapCanvas();
      }
      this.areaNamesById.set(
        Object.fromEntries(runtimeVm.areas.map((area) => [area.id, area.name]))
      );
      if (!this.shapeDraftForm.value.zone_id && runtimeVm.areas.length) {
        this.shapeDraftForm.patchValue({ zone_id: runtimeVm.areas[0].id });
      }
      return { ...runtimeVm, maps, mapView: this.currentMapView() };
    })
  );

  ngOnInit(): void {
    if (typeof window !== 'undefined' && window.innerWidth <= 640) {
      this.showMapEditor.set(false);
      this.showMapDetails.set(true);
    }
    this.selectedMapIdControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.reload$.next());
    this.shapeDraftForm.controls.zone_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((zoneId) => {
        const currentName = this.shapeDraftForm.controls.name.value?.trim() ?? '';
        if (currentName.length && currentName !== this.autoShapeName) {
          return;
        }
        this.autoShapeName = this.defaultShapeName(zoneId);
        this.shapeDraftForm.patchValue(
          { name: this.autoShapeName },
          { emitEvent: false }
        );
      });
    this.reload$.next();
  }

  private initializeMap(): void {
    if (!this.mapSurface) {
      return;
    }
    this.map = L.map(this.mapSurface.nativeElement, {
      crs: L.CRS.Simple,
      minZoom: -2,
      zoomControl: true,
    });
    this.map.addLayer(this.drawnItems);
    this.installDrawControls();
    this.map.setView([450, 800], 0);
  }

  private installDrawControls(): void {
    if (!this.map) {
      return;
    }
    const drawControlConstructor = (L as any).Control?.Draw;
    if (!drawControlConstructor) {
      this.shapeError.set('Zeichenwerkzeuge konnten nicht geladen werden.');
      return;
    }
    const drawControl = new drawControlConstructor({
      edit: { featureGroup: this.drawnItems },
      draw: { rectangle: false, circle: false, marker: false, circlemarker: false, polyline: false },
    });
    this.drawControl = drawControl;
    this.map.addControl(drawControl);
    this.map.on('draw:created', (event: any) => this.handleCreated(event));
    this.map.on('draw:edited', (event: any) => this.handleEdited(event));
    this.map.on('draw:deleted', (event: any) => this.handleDeleted(event));
  }

  onImageSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      this.pendingImageDataUrl = result;
      this.mapForm.patchValue({ image_url: result });
      const image = new Image();
      image.onload = () => {
        this.mapForm.patchValue({ width: image.width, height: image.height });
      };
      image.src = result;
    };
    reader.readAsDataURL(file);
  }

  saveMap(): void {
    const raw = this.mapForm.getRawValue();
    const payload = {
      ...raw,
      image_url: this.pendingImageDataUrl ?? raw.image_url,
    };
    const request$ = this.selectedMap()
      ? this.api.updateMap(this.selectedMap()!.id, payload)
      : this.api.createMap(payload);
    this.isSavingMap.set(true);
    request$.pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.isSavingMap.set(false))
    ).subscribe({
      next: (map) => {
        this.mapFeedback.set(this.selectedMap() ? 'Karte gespeichert.' : 'Karte angelegt.');
        this.mapError.set('');
        this.selectedMapIdControl.setValue(map.id, { emitEvent: false });
        this.selectedMap.set(map);
        this.reload$.next();
      },
      error: (error) => {
        this.mapFeedback.set('');
        this.mapError.set(error?.error?.detail ?? 'Karte konnte nicht gespeichert werden.');
      },
    });
  }

  resetMapForm(): void {
    this.pendingImageDataUrl = null;
    this.selectedMap.set(null);
    this.currentMapView.set(null);
    this.selectedShape.set(null);
    this.mapFeedback.set('');
    this.mapError.set('');
    this.selectedMapIdControl.setValue(null, { emitEvent: false });
    this.mapForm.reset({ name: '', image_url: '', width: 1600, height: 900 });
    this.clearMapCanvas();
  }

  triggerLeafletAction(selector: string): void {
    const button = this.mapSurface?.nativeElement.parentElement?.querySelector(selector) as HTMLAnchorElement | null;
    button?.click();
  }

  minutesForShape(shape: ZoneMapShapeView): number {
    return this.shapeMinutes()[shape.id] ?? shape.zone_status.default_manual_duration_minutes;
  }

  setShapeMinutes(shapeId: number, minutes: number, maxMinutes: number): void {
    this.shapeMinutes.update((state) => ({
      ...state,
      [shapeId]: Math.max(1, Math.min(minutes, maxMinutes)),
    }));
  }

  startShape(shape: ZoneMapShapeView): void {
    this.shapeFeedback.set(`${this.displayShapeName(shape)} wird gestartet.`);
    this.runtime.startArea(shape.zone_id, this.minutesForShape(shape));
  }

  stopShape(shape: ZoneMapShapeView): void {
    this.shapeFeedback.set('Bewässerung wird gestoppt.');
    this.runtime.stopArea(shape.zone_id);
  }

  toggleAreaPause(shape: ZoneMapShapeView): void {
    this.runtime.setAreaActive(shape.zone_id, !shape.zone_status.active);
  }

  openSchedules(zoneId?: number): void {
    void this.router.navigate(['/schedules'], {
      queryParams: zoneId ? { zoneId } : {},
    });
  }

  manualDisabled(shape: ZoneMapShapeView): boolean {
    return !!this.manualDisabledReason(shape);
  }

  manualDisabledReason(shape: ZoneMapShapeView): string {
    return shape.zone_status.manual_start_block_reason ?? '';
  }

  reloadSelectedMap(): void {
    this.reload$.next();
  }

  zoomMapIn(): void {
    this.map?.zoomIn();
  }

  zoomMapOut(): void {
    this.map?.zoomOut();
  }

  private renderMap(view: GardenMapView): void {
    if (!this.map) {
      return;
    }
    this.clearMapCanvas();
    const bounds = L.latLngBounds([0, 0], [view.map.height, view.map.width]);
    this.map.setMaxBounds(bounds);
    if (view.map.image_url) {
      this.imageOverlay = L.imageOverlay(view.map.image_url, bounds);
      this.imageOverlay.on('load', () => {
        this.map?.invalidateSize();
        this.map?.fitBounds(bounds, { padding: [20, 20] });
      });
      this.imageOverlay.on('error', () => {
        this.mapError.set('Das Gartenbild konnte nicht geladen werden.');
      });
      this.imageOverlay.addTo(this.map);
    } else {
      this.map.fitBounds(bounds, { padding: [20, 20] });
    }
    const nextSelectedId = this.selectedShape()?.id ?? null;
    this.selectedShape.set(null);

    for (const shape of view.shapes) {
      const layer = L.geoJSON(shape.geometry_json as any, {
        style: () => this.resolveStyle(shape),
      }).getLayers()[0] as L.Layer;
      if (!layer) {
        continue;
      }
      this.drawnItems.addLayer(layer);
      this.layerByShapeId.set(shape.id, layer);
      const polygon = layer as L.Polygon;
      polygon.bindTooltip(this.tooltipFor(shape), {
        permanent: true,
        direction: 'center',
        className: 'leaflet-tooltip-own',
        opacity: 0.95,
      });
      layer.on('click', () => {
        this.selectedShape.set(shape);
        this.showMapDetails.set(true);
      });
      if (shape.id === nextSelectedId) {
        this.selectedShape.set(shape);
      }
    }
    setTimeout(() => {
      this.map?.invalidateSize();
      this.map?.fitBounds(bounds, { padding: [20, 20] });
    }, 0);
  }

  private clearMapCanvas(): void {
    this.drawnItems.clearLayers();
    this.layerByShapeId.clear();
    if (this.map && this.imageOverlay) {
      this.map.removeLayer(this.imageOverlay);
    }
    this.imageOverlay = undefined;
  }

  private resolveStyle(shape: ZoneMapShapeView): L.PathOptions {
    const palette: Record<string, { color: string; fillColor: string }> = {
      disabled: { color: '#8f98a3', fillColor: '#c4cad1' },
      active: { color: '#2f7d4b', fillColor: '#67b883' },
      watering: { color: '#2d6cdf', fillColor: '#72a7ff' },
      'scheduled-soon': { color: '#d7893b', fillColor: '#f0b36f' },
      paused: { color: '#d7893b', fillColor: '#f3c287' },
      error: { color: '#a73d2a', fillColor: '#e47d6b' },
    };
    const base = palette[shape.zone_status.status] ?? palette['active'];
    return {
      color: base.color,
      fillColor: base.fillColor,
      fillOpacity: 0.45,
      weight: 3,
      ...(shape.style_json ?? {}),
    };
  }

  private tooltipFor(shape: ZoneMapShapeView): string {
    return this.displayShapeName(shape);
  }

  private handleCreated(event: any): void {
    const map = this.selectedMap();
    if (!map) {
      this.shapeError.set('Bitte zuerst eine Karte anlegen oder auswählen.');
      return;
    }
    const zoneId = this.shapeDraftForm.value.zone_id;
    if (!zoneId) {
      this.shapeError.set('Bitte zuerst einen Bereich für die neue Fläche auswählen.');
      return;
    }
    const layer = event.layer as LeafletLayer;
    const payload = {
      garden_map_id: map.id,
      zone_id: zoneId,
      name: this.shapeDraftForm.value.name?.trim() || this.defaultShapeName(zoneId),
      geometry_json: layer.toGeoJSON(),
      style_json: {},
      ...this.computeLabelPosition(layer),
    };
    this.api.createMapShape(payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.shapeFeedback.set('Fläche gespeichert.');
        this.shapeError.set('');
        this.autoShapeName = this.defaultShapeName(this.shapeDraftForm.value.zone_id);
        this.shapeDraftForm.patchValue({ name: this.autoShapeName });
        this.reloadSelectedMap();
      },
      error: (error) => {
        this.shapeError.set(error?.error?.detail ?? 'Fläche konnte nicht gespeichert werden.');
        this.reloadSelectedMap();
      },
    });
  }

  private handleEdited(event: any): void {
    const map = this.selectedMap();
    const currentMapView = this.currentMapView();
    if (!map) {
      return;
    }
    const requests: ReturnType<ApiService['updateMapShape']>[] = [];
    event.layers.eachLayer((layer: LeafletLayer) => {
      const shapeId = this.findShapeIdByLayer(layer);
      const currentShape = currentMapView?.shapes.find((shape) => shape.id === shapeId) ?? null;
      if (!shapeId || !currentShape) {
        return;
      }
      requests.push(
        this.api.updateMapShape(shapeId, {
          garden_map_id: map.id,
          zone_id: currentShape.zone_id,
          name: currentShape.name,
          geometry_json: layer.toGeoJSON(),
          style_json: currentShape.style_json ?? {},
          ...this.computeLabelPosition(layer),
        })
      );
    });
    if (!requests.length) {
      return;
    }
    forkJoin(requests).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.shapeFeedback.set('Fläche aktualisiert.');
        this.shapeError.set('');
        this.reloadSelectedMap();
      },
      error: (error) => {
        this.shapeError.set(error?.error?.detail ?? 'Fläche konnte nicht aktualisiert werden.');
        this.reloadSelectedMap();
      },
    });
  }

  private handleDeleted(event: any): void {
    const requests: ReturnType<ApiService['deleteMapShape']>[] = [];
    event.layers.eachLayer((layer: L.Layer) => {
      const shapeId = this.findShapeIdByLayer(layer);
      if (shapeId) {
        requests.push(this.api.deleteMapShape(shapeId));
      }
    });
    if (!requests.length) {
      return;
    }
    forkJoin(requests).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.shapeFeedback.set('Fläche gelöscht.');
        this.shapeError.set('');
        this.selectedShape.set(null);
        this.reloadSelectedMap();
      },
      error: (error) => {
        this.shapeError.set(error?.error?.detail ?? 'Fläche konnte nicht gelöscht werden.');
        this.reloadSelectedMap();
      },
    });
  }

  private findShapeIdByLayer(layer: L.Layer): number | null {
    for (const [shapeId, storedLayer] of this.layerByShapeId.entries()) {
      if (storedLayer === layer) {
        return shapeId;
      }
    }
    return null;
  }

  private computeLabelPosition(layer: L.Layer): { label_position_x: number | null; label_position_y: number | null } {
    const polygon = layer as L.Polygon;
    if (!polygon.getBounds) {
      return { label_position_x: null, label_position_y: null };
    }
    const center = polygon.getBounds().getCenter();
    return { label_position_x: center.lng, label_position_y: center.lat };
  }

  private defaultShapeName(zoneId: number | null | undefined): string {
    if (!zoneId) {
      return '';
    }
    return this.areaNamesById()[zoneId] ?? `Bereich ${zoneId}`;
  }

  displayShapeName(shape: ZoneMapShapeView): string {
    return shape.name?.trim() || this.defaultShapeName(shape.zone_id);
  }
}
