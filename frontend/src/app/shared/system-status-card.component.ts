import { CommonModule, DatePipe } from '@angular/common';
import { Component, Input } from '@angular/core';

import { SystemSummary } from '../core/api.models';
import { AreaStatusBadgeComponent } from './area-status-badge.component';
import { ExpertSectionComponent } from './expert-section.component';
import { WeatherAnalysisPanelComponent } from './weather-analysis-panel.component';
import { WeatherOverviewBarComponent } from './weather-overview-bar.component';

@Component({
  selector: 'app-system-status-card',
  standalone: true,
  imports: [CommonModule, DatePipe, AreaStatusBadgeComponent, WeatherOverviewBarComponent, ExpertSectionComponent, WeatherAnalysisPanelComponent],
  template: `
    <section class="system-status-card" [class]="'system-' + summary.status">
      <div class="system-status-top">
        <div>
          <div class="eyebrow">Systemzustand</div>
          <h2>{{ summary.headline }}</h2>
          <p>{{ summary.detail }}</p>
        </div>
        <app-area-status-badge [status]="summary.status" />
      </div>

      <app-weather-overview-bar [overview]="summary.weather_overview" />

      <app-expert-section [enabled]="expertMode" title="Wetteranalyse">
        <app-weather-analysis-panel [overview]="summary.weather_overview" />
      </app-expert-section>

      <div class="system-status-grid">
        <div class="system-fact system-fact-water"><span>Wasserstatus</span><strong>{{ waterStatusLabel(summary.current_water_status) }}</strong></div>
        <div class="system-fact system-fact-next"><span>Nächste Bewässerung</span><strong>{{ summary.next_watering_at ? (summary.next_watering_at | date: 'short') : 'Noch kein nächster Lauf' }}</strong></div>
        <div class="system-fact system-fact-weather"><span>Wetterentscheidung</span><strong>{{ summary.weather_overview.headline }}</strong></div>
        <div class="system-fact system-fact-schedules"><span>Aktive Zeitpläne</span><strong>{{ summary.active_schedule_count }}</strong></div>
        <div class="system-fact system-fact-last"><span>Letzter Lauf</span><strong>{{ summary.last_run_zone_name ? (summary.last_run_zone_name + (summary.last_run_finished_at ? ' · ' + (summary.last_run_finished_at | date: 'short') : '')) : 'Noch kein Verlauf' }}</strong></div>
      </div>
    </section>
  `,
})
export class SystemStatusCardComponent {
  @Input({ required: true }) summary!: SystemSummary;
  @Input() expertMode = false;

  waterStatusLabel(value: string): string {
    if (value === 'läuft') {
      return 'Bewässerung läuft';
    }
    if (value === 'wird vorbereitet') {
      return 'Start wird vorbereitet';
    }
    if (value === 'wird gestoppt') {
      return 'Ventile schließen';
    }
    return 'Ventile geschlossen';
  }
}
