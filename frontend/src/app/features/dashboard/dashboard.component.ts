import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AppSettings, Zone } from '../../core/api.models';
import { UiPreferencesService } from '../../core/ui-preferences.service';
import { AreaCardComponent } from '../../shared/area-card.component';
import { ExpertSectionComponent } from '../../shared/expert-section.component';
import { QuickActionsComponent } from '../../shared/quick-actions.component';
import { SystemStatusCardComponent } from '../../shared/system-status-card.component';
import { WinterModeBannerComponent } from '../../shared/winter-mode-banner.component';
import { RuntimeFacade } from '../../state/runtime/runtime.facade';

export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function isGermanFathersDay(date: Date = new Date()): boolean {
  const easter = easterSunday(date.getFullYear());
  const ascensionDay = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 39);
  return date.getFullYear() === ascensionDay.getFullYear()
    && date.getMonth() === ascensionDay.getMonth()
    && date.getDate() === ascensionDay.getDate();
}

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [
    CommonModule,
    SystemStatusCardComponent,
    QuickActionsComponent,
    WinterModeBannerComponent,
    AreaCardComponent,
    ExpertSectionComponent,
  ],
  template: `
    <section class="page-title page-title-mobile-hidden">
      <h2>Dashboard</h2>
      <p>Alles Wichtige auf einen Blick: Zustand, nächste Bewässerung und schnelle Eingriffe.</p>
    </section>

    <section class="gift-hero" *ngIf="showFathersDayBanner" aria-label="Vatertagsgeschenk">
      <div class="gift-hero-copy">
        <span class="gift-kicker">Dein Geschenk</span>
        <h2>Alles Gute zum Vatertag</h2>
        <p>Heute läuft die Bewässerung mit Extra-Hopfen: Smart Garden kümmert sich um die Pflanzen, das Bier bleibt für dich.</p>
      </div>
      <div class="gift-hero-media">
        <img src="fathers-day-beer-irrigation.gif" alt="Vatertagsgeschenk: Bierfass-Bewaesserung im Garten" />
        <span>Vatertags-Modus aktiviert</span>
      </div>
    </section>

    <ng-container *ngIf="vm$ | async as vm">
      <section class="panel loading-panel" *ngIf="!vm.ready">
        <div class="spinner" aria-hidden="true"></div>
        <div>
          <h3>Dashboard wird geladen</h3>
          <p class="muted">Status, Wetter und Bereiche werden gerade abgefragt.</p>
        </div>
      </section>
      <p class="notice error" *ngIf="vm.error">{{ vm.error }}</p>
      <app-winter-mode-banner [active]="vm.settings.winter_mode_active" (disable)="setWinterMode(false)" />
      <app-system-status-card *ngIf="vm.summary" [summary]="vm.summary" [expertMode]="expertMode()" />

      <section class="panel">
        <h3>Schnellaktionen</h3>
        <app-quick-actions
          [paused]="isPaused(vm.settings)"
          [safetyStopActive]="vm.settings.safety_stop_active"
          (runAllAreas)="runAllAreas()"
          (stopAll)="stopAll()"
          (releaseSafetyStop)="releaseSafetyStop()"
          (pause24h)="togglePause(vm.settings)"
        />
        <p class="notice success" *ngIf="feedback()">{{ feedback() }}</p>
        <p class="notice success" *ngIf="vm.summary.manual_sequence_notice">{{ vm.summary.manual_sequence_notice }}</p>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <h3>Bereiche</h3>
            <p class="muted section-subcopy">Jeder Bereich zeigt Zustand, nächste Bewässerung und einen komfortablen manuellen Start.</p>
          </div>
        </div>

        <div class="area-grid dashboard-area-grid">
          <app-area-card
            *ngFor="let area of vm.areas"
            [area]="area"
            [status]="statusForArea(area)"
            [selectedMinutes]="minutesFor(area)"
            [manualDisabled]="manualDisabled(area)"
            [manualDisabledReason]="manualDisabledReason(area)"
            [expertMode]="expertMode()"
            (selectedMinutesChange)="setMinutes(area.id, $event, area.max_duration_minutes)"
            (start)="startArea(area)"
            (stop)="stopArea(area.id)"
            (editSchedule)="openSchedules($event)"
            (editArea)="openAreas()"
          />
        </div>
      </section>

      <app-expert-section [enabled]="expertMode()" title="Experten- und Debugbereich">
        <div class="expert-grid">
          <div>Systemstatus: {{ vm.summary.status }}</div>
          <div>Sicherheitsstopp: {{ vm.settings.safety_stop_active ? 'aktiv' : 'aus' }}</div>
          <div>Pausiert bis: {{ vm.settings.system_paused_until || '-' }}</div>
          <div>Winterbetrieb: {{ vm.settings.winter_mode_active ? 'aktiv' : 'aus' }}</div>
        </div>
      </app-expert-section>
    </ng-container>
  `,
})
export class DashboardComponent {
  private readonly router = inject(Router);
  private readonly preferences = inject(UiPreferencesService);
  private readonly runtime = inject(RuntimeFacade);

  readonly expertMode = computed(() => this.preferences.expertMode());
  readonly manualMinutes = signal<Record<number, number>>({});
  readonly feedback = signal('');
  readonly vm$ = this.runtime.vm$;
  readonly showFathersDayBanner = isGermanFathersDay();

  minutesFor(area: Zone): number {
    return this.manualMinutes()[area.id] ?? area.default_manual_duration_minutes;
  }

  setMinutes(areaId: number, minutes: number, maxMinutes: number): void {
    this.manualMinutes.update((state) => ({
      ...state,
      [areaId]: Math.min(Math.max(1, minutes), maxMinutes),
    }));
  }

  statusForArea(area: Zone): 'disabled' | 'active' | 'watering' | 'scheduled-soon' | 'paused' | 'error' {
    return area.status;
  }

  manualDisabled(area: Zone): boolean {
    return !!this.manualDisabledReason(area);
  }

  manualDisabledReason(area: Zone): string {
    return area.manual_start_block_reason ?? '';
  }

  startArea(area: Zone): void {
    this.feedback.set(`${area.name} wird gestartet.`);
    this.runtime.startArea(area.id, this.minutesFor(area));
  }

  stopArea(areaId: number): void {
    this.feedback.set('Bewässerung wird gestoppt.');
    this.runtime.stopArea(areaId);
  }

  stopAll(): void {
    this.feedback.set('Alle Bewässerungen werden gestoppt.');
    this.runtime.stopAll();
  }

  releaseSafetyStop(): void {
    this.feedback.set('System wird wieder freigegeben.');
    this.runtime.releaseSafetyStop();
  }

  runAllAreas(): void {
    this.feedback.set('Gesamtbewässerung wird vorbereitet.');
    this.runtime.runAllAreas();
  }

  togglePause(settings: AppSettings): void {
    if (this.isPaused(settings)) {
      this.feedback.set('Pause wird beendet.');
      this.runtime.clearPause();
      return;
    }
    this.feedback.set('System wird für 24 Stunden pausiert.');
    this.runtime.pauseForHours(24);
  }

  setWinterMode(active: boolean): void {
    if (active) {
      void this.router.navigate(['/settings'], { queryParams: { section: 'winter' } });
      return;
    }
    this.runtime.setWinterMode({
      active: false,
      disable_manual_start: true,
      pause_schedules: true,
      safety_shutdown: true,
    });
    this.feedback.set('Winterbetrieb wird beendet.');
  }

  openSchedules(zoneId?: number): void {
    void this.router.navigate(['/schedules'], {
      queryParams: zoneId ? { zoneId } : {},
    });
  }

  openAreas(): void {
    void this.router.navigate(['/areas']);
  }

  isPaused(settings: AppSettings): boolean {
    return !!(settings.system_paused_until && new Date(settings.system_paused_until).getTime() > Date.now());
  }
}
