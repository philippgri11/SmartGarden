import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-expert-section',
  standalone: true,
  imports: [CommonModule],
  template: `
    <details class="expert-section" *ngIf="enabled" [open]="open">
      <summary>{{ title }}</summary>
      <div class="expert-body">
        <ng-content />
      </div>
    </details>
  `,
})
export class ExpertSectionComponent {
  @Input() enabled = false;
  @Input() open = false;
  @Input() title = 'Expertenmodus';
}
