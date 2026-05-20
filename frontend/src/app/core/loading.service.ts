import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly pending = signal(0);
  private readonly delayed = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly visible = computed(() => this.pending() > 0 && this.delayed());

  begin(): void {
    this.pending.update((value) => value + 1);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.delayed.set(true);
        this.timer = undefined;
      }, 250);
    }
  }

  end(): void {
    this.pending.update((value) => Math.max(0, value - 1));
    if (this.pending() === 0) {
      this.delayed.set(false);
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    }
  }
}
