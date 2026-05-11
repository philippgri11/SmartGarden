import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { UiPreferencesService } from './core/ui-preferences.service';
import { EmergencyStopButtonComponent } from './shared/emergency-stop-button.component';
import { RuntimeFacade } from './state/runtime/runtime.facade';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, EmergencyStopButtonComponent],
  template: `
    <div class="app-shell">
      <header class="app-header">
        <div>
          <div class="eyebrow">Smart Garden</div>
          <h1>Gartenbewässerung</h1>
        </div>
        <div class="header-actions">
          <label class="expert-toggle">
            <input type="checkbox" [checked]="expertMode()" (change)="preferences.toggleExpertMode()" />
            Expertenmodus
          </label>
          <app-emergency-stop-button (trigger)="stopAll()" />
        </div>
        <div class="mobile-header-actions">
          <button class="button secondary mobile-menu-toggle" type="button" (click)="toggleMobileMenu()">
            Menü
          </button>
          <div class="mobile-header-menu-body" *ngIf="mobileMenuOpen()">
            <nav class="mobile-header-nav">
              <a
                *ngFor="let item of navItems"
                [routerLink]="item.path"
                routerLinkActive="active"
                class="mobile-nav-pill"
                (click)="closeMobileMenu()"
              >
                {{ item.label }}
              </a>
            </nav>
            <label class="expert-toggle">
              <input type="checkbox" [checked]="expertMode()" (change)="toggleExpertModeFromMobile()" />
              Expertenmodus
            </label>
          </div>
        </div>
      </header>

      <nav class="top-nav">
        <a *ngFor="let item of navItems" [routerLink]="item.path" routerLinkActive="active" class="nav-pill">{{ item.label }}</a>
      </nav>

      <main class="content-shell">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AppComponent implements OnInit {
  readonly preferences = inject(UiPreferencesService);
  private readonly runtime = inject(RuntimeFacade);

  readonly expertMode = computed(() => this.preferences.expertMode());
  readonly mobileMenuOpen = signal(false);
  readonly navItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/garden-map', label: 'Gartenkarte' },
    { path: '/areas', label: 'Bereiche' },
    { path: '/schedules', label: 'Zeitpläne' },
    { path: '/history', label: 'Verlauf' },
    { path: '/settings', label: 'Einstellungen' },
  ];

  ngOnInit(): void {
    this.runtime.load('app-init');
  }

  stopAll(): void {
    this.runtime.stopAll();
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((value) => !value);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  toggleExpertModeFromMobile(): void {
    this.preferences.toggleExpertMode();
    this.closeMobileMenu();
  }
}
