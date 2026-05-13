import { Routes } from '@angular/router';

import { DashboardComponent } from './features/dashboard/dashboard.component';
import { GardenMapComponent } from './features/garden-map/garden-map.component';
import { HistoryComponent } from './features/history/history.component';
import { PlanningComponent } from './features/planning/planning.component';
import { SchedulesComponent } from './features/schedules/schedules.component';
import { SettingsComponent } from './features/settings/settings.component';
import { ZonesComponent } from './features/zones/zones.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'garden-map', component: GardenMapComponent },
  { path: 'areas', component: ZonesComponent },
  { path: 'zones', pathMatch: 'full', redirectTo: 'areas' },
  { path: 'schedules', component: SchedulesComponent },
  { path: 'planning', component: PlanningComponent },
  { path: 'history', component: HistoryComponent },
  { path: 'settings', component: SettingsComponent }
];
