import { Injectable, signal } from '@angular/core';

const EXPERT_MODE_KEY = 'irrigation-control.expert-mode';

@Injectable({ providedIn: 'root' })
export class UiPreferencesService {
  readonly expertMode = signal<boolean>(this.readExpertMode());

  toggleExpertMode(): void {
    this.setExpertMode(!this.expertMode());
  }

  setExpertMode(value: boolean): void {
    this.expertMode.set(value);
    try {
      localStorage.setItem(EXPERT_MODE_KEY, JSON.stringify(value));
    } catch {
      // Ignore local storage errors in restricted contexts.
    }
  }

  private readExpertMode(): boolean {
    try {
      return JSON.parse(localStorage.getItem(EXPERT_MODE_KEY) ?? 'false') === true;
    } catch {
      return false;
    }
  }
}
