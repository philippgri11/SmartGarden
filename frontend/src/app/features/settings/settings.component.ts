import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { AppSettings, SystemPodsResponse } from '../../core/api.models';
import { UiPreferencesService } from '../../core/ui-preferences.service';
import { ExpertSectionComponent } from '../../shared/expert-section.component';

@Component({
  standalone: true,
  selector: 'app-settings',
  imports: [CommonModule, ReactiveFormsModule, ExpertSectionComponent],
  template: `
    <section class="page-title">
      <h2>Einstellungen</h2>
      <p>Standort, Wettersteuerung und Systemverhalten verständlich anpassen.</p>
    </section>

    <section class="panel">
      <div class="loading-panel" *ngIf="settingsLoading()">
        <div class="spinner" aria-hidden="true"></div>
        <div>
          <h3>Einstellungen werden geladen</h3>
          <p class="muted">Die gespeicherten Werte werden vom Backend gelesen.</p>
        </div>
      </div>
      <form [formGroup]="form" class="form-grid form-grid-balanced settings-form-grid" (ngSubmit)="save()">
        <label class="field field-span-4">
          <span>Ort oder Gartenname</span>
          <input formControlName="location_name" placeholder="z. B. Zuhause, Musterstadt" />
        </label>
        <label class="field field-span-2">
          <span>PLZ</span>
          <input formControlName="postal_code" placeholder="z. B. 10115" />
          <small class="muted">Beim Speichern wird die PLZ in Koordinaten umgerechnet, solange du keine Koordinaten manuell änderst.</small>
        </label>
        <div class="field field-span-2">
          <span>Standort</span>
          <button class="button button-subtle" type="button" (click)="useBrowserLocation()" [disabled]="locating()">
            {{ locating() ? 'GPS wird gelesen...' : 'Per GPS ermitteln' }}
          </button>
        </div>
        <label class="field field-span-2">
          <span>Wettersteuerung aktiv</span>
          <select formControlName="weather_enabled">
            <option [ngValue]="true">Ja</option>
            <option [ngValue]="false">Nein</option>
          </select>
        </label>
        <label class="field field-span-2">
          <span>Regenwahrscheinlichkeit ab</span>
          <input type="number" formControlName="weather_probability_threshold" />
        </label>
        <label class="field field-span-2">
          <span>Regenmenge ab</span>
          <input type="number" step="0.1" formControlName="weather_precipitation_mm_threshold" />
        </label>
        <label class="field field-span-3">
          <span>Betrachtungszeitraum in Stunden</span>
          <input type="number" formControlName="weather_window_hours" />
        </label>
        <label class="field field-span-3">
          <span>Wenn Wetterdaten nicht verfügbar sind</span>
          <select formControlName="weather_fail_mode">
            <option value="deny">Nicht bewässern</option>
            <option value="allow">Trotzdem bewässern</option>
          </select>
          <small class="muted">Wenn du „Nicht bewässern“ wählst, startet die Anlage bei fehlenden Wetterdaten sicherheitshalber nicht.</small>
        </label>

        <app-expert-section [enabled]="expertMode()" title="Koordinaten und Expertenwerte">
          <div class="form-grid form-grid-balanced">
            <label class="field field-span-3">
              <span>Latitude</span>
              <input type="number" step="0.0001" formControlName="latitude" />
            </label>
            <label class="field field-span-3">
              <span>Longitude</span>
              <input type="number" step="0.0001" formControlName="longitude" />
            </label>
          </div>
        </app-expert-section>

        <section class="location-map field-full" aria-label="Standortprüfung">
          <div class="location-map-copy">
            <div>
              <h3>Standortprüfung</h3>
              <p class="muted">
                Wetter und Planung nutzen diese Koordinaten. Nach dem Speichern zeigt die Karte den wirklich gespeicherten Standort.
              </p>
              <p class="muted location-coordinates" *ngIf="coordinateLabel()">{{ coordinateLabel() }}</p>
            </div>
            <a class="button button-subtle" *ngIf="googleMapsLink()" [href]="googleMapsLink()" target="_blank" rel="noopener">
              In Google Maps öffnen
            </a>
          </div>
          <iframe
            *ngIf="googleMapsEmbedUrl() as mapUrl"
            title="Standort in Google Maps"
            [src]="mapUrl"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
          ></iframe>
        </section>

        <div class="toolbar field-full">
          <button class="button" type="submit" [disabled]="saving()">
            {{ saving() ? 'Speichert...' : 'Einstellungen speichern' }}
          </button>
        </div>
      </form>
      <p class="notice success" *ngIf="feedback()">{{ feedback() }}</p>
      <p class="notice warning" *ngIf="locationError()">{{ locationError() }}</p>
    </section>

    <app-expert-section [enabled]="expertMode()" [open]="true" title="Kubernetes Pods und Ressourcen">
      <div class="section-head compact-section-head">
        <div>
          <h3>Clusterstatus</h3>
          <p class="muted">Nur lesende Diagnose: Pod-Zustand, Restarts und aktuelle CPU-/Speichernutzung, falls die Metrics-API verfügbar ist.</p>
        </div>
        <button class="button secondary" type="button" (click)="loadPods()" [disabled]="podsLoading()">
          {{ podsLoading() ? 'Aktualisiert...' : 'Aktualisieren' }}
        </button>
      </div>

      <div class="loading-panel" *ngIf="podsLoading()">
        <div class="spinner" aria-hidden="true"></div>
        <div>
          <h3>Pod-Status wird geladen</h3>
          <p class="muted">Das Backend fragt die Kubernetes API rein lesend ab.</p>
        </div>
      </div>

      <p class="notice warning" *ngIf="pods()?.available === false">{{ pods()?.message }}</p>
      <p class="notice error" *ngIf="podsError()">{{ podsError() }}</p>

      <div class="scenario-table-wrap" *ngIf="pods() as podState">
        <p class="muted">Namespace: {{ podState.namespace }}</p>

        <div class="pod-summary-grid" *ngIf="podState.available">
          <div>
            <span class="muted">Pods bereit</span>
            <strong>{{ resourceSummary().readyPods }}/{{ resourceSummary().podCount }}</strong>
          </div>
          <div>
            <span class="muted">CPU aktuell</span>
            <strong>{{ formatCpu(resourceSummary().cpuMillicores) }}</strong>
          </div>
          <div>
            <span class="muted">Speicher aktuell</span>
            <strong>{{ formatMemory(resourceSummary().memoryMebibytes) }}</strong>
          </div>
          <div>
            <span class="muted">Restarts</span>
            <strong>{{ resourceSummary().restartCount }}</strong>
          </div>
        </div>

        <h4 class="table-section-title" *ngIf="podState.deployments.length">Workloads</h4>
        <table class="scenario-table responsive-card-table system-deployments-table" *ngIf="podState.deployments.length">
          <thead>
            <tr>
              <th>Deployment</th>
              <th>Gewünscht</th>
              <th>Bereit</th>
              <th>Verfügbar</th>
              <th>Aktualisiert</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let deployment of podState.deployments">
              <td data-label="Deployment"><strong>{{ deployment.name }}</strong></td>
              <td data-label="Gewünscht">{{ deployment.desired_replicas }}</td>
              <td data-label="Bereit">{{ deployment.ready_replicas }}</td>
              <td data-label="Verfügbar">{{ deployment.available_replicas }}</td>
              <td data-label="Aktualisiert">{{ deployment.updated_replicas }}</td>
            </tr>
          </tbody>
        </table>

        <h4 class="table-section-title" *ngIf="podState.pods.length">Pods</h4>
        <table class="scenario-table responsive-card-table system-pods-table" *ngIf="podState.pods.length; else noPods">
          <thead>
            <tr>
              <th>Pod</th>
              <th>Status</th>
              <th>Bereit</th>
              <th>Restarts</th>
              <th>CPU</th>
              <th>Speicher</th>
              <th>Erstellt</th>
              <th>Node</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let pod of podState.pods">
              <td data-label="Pod">
                <strong>{{ pod.app || pod.name }}</strong>
                <span class="muted table-subline">Pod: {{ pod.name }}</span>
              </td>
              <td data-label="Status">
                <span class="status-chip" [class.status-paused]="!pod.ready">{{ pod.phase }}</span>
              </td>
              <td data-label="Bereit">{{ pod.ready_containers }}/{{ pod.total_containers }}</td>
              <td data-label="Restarts">{{ pod.restart_count }}</td>
              <td data-label="CPU">{{ formatCpu(pod.cpu_millicores) }}</td>
              <td data-label="Speicher">{{ formatMemory(pod.memory_mebibytes) }}</td>
              <td data-label="Erstellt">
                <strong>{{ formatPodCreatedAt(pod.created_at) }}</strong>
                <span class="muted table-subline">{{ podAgeLabel(pod.created_at) }}</span>
              </td>
              <td data-label="Node">{{ pod.node_name || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <ng-template #noPods>
          <p class="muted">Keine Pods gefunden.</p>
        </ng-template>
      </div>
    </app-expert-section>

    <section #winterSection class="panel">
      <div class="section-head">
        <div>
          <h3>Winterbetrieb</h3>
          <p class="muted">Schalte die Anlage für die kalte Jahreszeit bewusst in einen sicheren Zustand.</p>
        </div>
      </div>

      <p class="notice success" *ngIf="form.controls.winter_mode_active.value">
        Winterbetrieb aktiv. Automatische Bewässerung ist ausgeschaltet und alle Ventile bleiben geschlossen.
      </p>

      <div class="form-grid form-grid-balanced settings-form-grid">
        <label class="field field-span-4">
          <span>Manuelle Starts im Winterbetrieb</span>
          <select [formControl]="form.controls.winter_disable_manual_start">
            <option [ngValue]="true">Deaktivieren</option>
            <option [ngValue]="false">Erlauben</option>
          </select>
        </label>
        <label class="field field-span-4">
          <span>Zeitpläne im Winterbetrieb</span>
          <select [formControl]="form.controls.winter_pause_schedules">
            <option [ngValue]="true">Pausieren</option>
            <option [ngValue]="false">Weiter anzeigen</option>
          </select>
        </label>
        <label class="field field-span-4">
          <span>Sicherheitsabschaltung beim Aktivieren</span>
          <select [formControl]="form.controls.safety_shutdown_on_winter">
            <option [ngValue]="true">Ausführen</option>
            <option [ngValue]="false">Nicht ausführen</option>
          </select>
        </label>
      </div>

      <div class="toolbar">
        <button
          class="button"
          type="button"
          *ngIf="!form.controls.winter_mode_active.value"
          (click)="toggleWinterMode(true)"
        >
          Winterbetrieb aktivieren
        </button>
        <button
          class="button secondary"
          type="button"
          *ngIf="form.controls.winter_mode_active.value"
          (click)="toggleWinterMode(false)"
        >
          Winterbetrieb beenden
        </button>
      </div>
    </section>
  `,
})
export class SettingsComponent {
  @ViewChild('winterSection')
  private winterSection?: ElementRef<HTMLElement>;

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly preferences = inject(UiPreferencesService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  readonly expertMode = computed(() => this.preferences.expertMode());
  readonly feedback = signal('');
  readonly settingsLoading = signal(true);
  readonly saving = signal(false);
  readonly locating = signal(false);
  readonly locationError = signal('');
  readonly googleMapsLink = signal('');
  readonly googleMapsEmbedUrl = signal<SafeResourceUrl | null>(null);
  readonly coordinateLabel = signal('');
  readonly pods = signal<SystemPodsResponse | null>(null);
  readonly podsLoading = signal(false);
  readonly podsError = signal('');
  readonly resourceSummary = computed(() => {
    const pods = this.pods()?.pods ?? [];
    return {
      podCount: pods.length,
      readyPods: pods.filter((pod) => pod.ready).length,
      restartCount: pods.reduce((sum, pod) => sum + pod.restart_count, 0),
      cpuMillicores: pods.reduce((sum, pod) => sum + (pod.cpu_millicores ?? 0), 0),
      memoryMebibytes: pods.reduce((sum, pod) => sum + (pod.memory_mebibytes ?? 0), 0),
    };
  });
  private podsLoaded = false;

  readonly form = this.fb.nonNullable.group({
    location_name: ['Mein Garten', Validators.required],
    postal_code: [''],
    latitude: [52.52, Validators.required],
    longitude: [13.405, Validators.required],
    weather_enabled: [true, Validators.required],
    weather_window_hours: [6, Validators.required],
    weather_probability_threshold: [70, Validators.required],
    weather_precipitation_mm_threshold: [2, Validators.required],
    weather_fail_mode: ['allow' as 'allow' | 'deny', Validators.required],
    winter_mode_active: [false, Validators.required],
    winter_disable_manual_start: [true, Validators.required],
    winter_pause_schedules: [true, Validators.required],
    safety_shutdown_on_winter: [true, Validators.required],
    system_paused_until: [''],
    safety_stop_active: [false, Validators.required],
    safety_stop_reason: [''],
  });

  constructor() {
    this.api.getSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((settings) => {
      this.patchSettings(settings);
      this.updateMapPreview();
      this.settingsLoading.set(false);
    }, () => {
      this.settingsLoading.set(false);
      this.locationError.set('Einstellungen konnten nicht geladen werden.');
    });

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateMapPreview();
    });

    effect(() => {
      if (this.expertMode() && !this.podsLoaded) {
        this.loadPods();
      }
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.get('section') === 'winter') {
        requestAnimationFrame(() => {
          this.winterSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    });
  }

  save(): void {
    const raw = this.form.getRawValue();
    this.feedback.set('');
    this.locationError.set('');
    this.saving.set(true);
    this.api.updateSettings({
      ...raw,
      postal_code: raw.postal_code || null,
      system_paused_until: raw.system_paused_until || null,
      safety_stop_reason: raw.safety_stop_reason || null,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((settings) => {
      this.patchSettings(settings);
      this.updateMapPreview();
      const coordinatesChangedByBackend = this.coordinatesDiffer(raw.latitude, settings.latitude) || this.coordinatesDiffer(raw.longitude, settings.longitude);
      this.feedback.set(coordinatesChangedByBackend
        ? 'Einstellungen gespeichert. Die Koordinaten wurden aus der PLZ übernommen.'
        : 'Einstellungen gespeichert.');
      this.locationError.set('');
      this.saving.set(false);
    }, () => {
      this.locationError.set('Einstellungen konnten nicht gespeichert werden. Prüfe PLZ oder Koordinaten.');
      this.saving.set(false);
    });
  }

  toggleWinterMode(active: boolean): void {
    const raw = this.form.getRawValue();
    this.api.updateWinterMode({
      active,
      disable_manual_start: raw.winter_disable_manual_start,
      pause_schedules: raw.winter_pause_schedules,
      safety_shutdown: raw.safety_shutdown_on_winter,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((settings) => {
      this.patchSettings(settings);
      this.feedback.set(active ? 'Winterbetrieb aktiviert.' : 'Winterbetrieb beendet.');
    });
  }

  useBrowserLocation(): void {
    this.locationError.set('');
    if (!navigator.geolocation) {
      this.locationError.set('Dieser Browser unterstützt keine Standortermittlung.');
      return;
    }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.form.patchValue({
          latitude: Number(position.coords.latitude.toFixed(5)),
          longitude: Number(position.coords.longitude.toFixed(5)),
        });
        this.updateMapPreview();
        this.feedback.set('GPS-Koordinaten übernommen. Speichere die Einstellungen, damit die Wettersteuerung sie nutzt.');
        this.locating.set(false);
      },
      () => {
        this.locationError.set('Standort konnte nicht ermittelt werden. Du kannst PLZ oder Koordinaten weiter manuell eintragen.');
        this.locating.set(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30 * 60 * 1000 }
    );
  }

  loadPods(): void {
    this.podsLoading.set(true);
    this.podsError.set('');
    this.api.getSystemPods().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((response) => {
      this.pods.set(response);
      this.podsLoaded = true;
      this.podsLoading.set(false);
    }, () => {
      this.podsError.set('Pod-Status konnte nicht geladen werden.');
      this.podsLoading.set(false);
    });
  }

  formatCpu(value: number | null | undefined): string {
    return value === null || value === undefined ? 'keine Metrics' : `${Math.round(value)} mCPU`;
  }

  formatMemory(value: number | null | undefined): string {
    return value === null || value === undefined ? 'keine Metrics' : `${value.toFixed(1).replace('.', ',')} MiB`;
  }

  formatPodCreatedAt(value: string | null | undefined): string {
    const createdAt = this.parseDate(value);
    if (!createdAt) {
      return '-';
    }
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Berlin',
    }).format(createdAt);
  }

  podAgeLabel(value: string | null | undefined): string {
    const createdAt = this.parseDate(value);
    if (!createdAt) {
      return '';
    }
    const ageMinutes = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 60000));
    if (ageMinutes < 1) {
      return 'gerade erstellt';
    }
    if (ageMinutes < 60) {
      return `seit ${ageMinutes} Min.`;
    }
    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours < 48) {
      return `seit ${ageHours} Std.`;
    }
    const ageDays = Math.floor(ageHours / 24);
    return `seit ${ageDays} Tagen`;
  }

  private patchSettings(settings: AppSettings): void {
    this.form.patchValue({
      ...settings,
      postal_code: settings.postal_code ?? '',
      system_paused_until: settings.system_paused_until ?? '',
      safety_stop_reason: settings.safety_stop_reason ?? '',
    });
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private updateMapPreview(): void {
    const latitude = Number(this.form.controls.latitude.value);
    const longitude = Number(this.form.controls.longitude.value);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      this.googleMapsLink.set('');
      this.googleMapsEmbedUrl.set(null);
      this.coordinateLabel.set('');
      return;
    }

    const coordinates = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    this.coordinateLabel.set(`Aktuell: ${coordinates}`);
    this.googleMapsLink.set(`https://www.google.com/maps?q=${encodeURIComponent(coordinates)}`);
    this.googleMapsEmbedUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.google.com/maps?q=${encodeURIComponent(coordinates)}&z=15&output=embed`,
    ));
  }

  private coordinatesDiffer(left: number, right: number): boolean {
    return Math.abs(Number(left) - Number(right)) > 0.00001;
  }
}
