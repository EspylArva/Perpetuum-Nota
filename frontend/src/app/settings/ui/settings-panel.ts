import { Component, input } from '@angular/core';

/**
 * A titled settings panel (one functionality, e.g. "Appearance" / "Dates").
 * Presentational: renders a card with a subtitle + optional description and
 * projects the setting rows. Reused by every settings group.
 */
@Component({
  selector: 'app-settings-panel',
  template: `
    <section class="settings-panel">
      <h2>{{ title() }}</h2>
      @if (description()) {
        <p class="panel-desc">{{ description() }}</p>
      }
      <div class="panel-body">
        <ng-content />
      </div>
    </section>
  `,
  styles: [
    `
      .settings-panel {
        background: var(--mat-sys-surface-container-low);
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 16px;
        padding: 1.1rem 1.25rem 0.6rem;
      }
      h2 { margin: 0 0 0.15rem; font-size: var(--sn-text-lg); font-weight: 600; }
      .panel-desc {
        margin: 0 0 0.4rem;
        font-size: var(--sn-text-sm);
        color: var(--mat-sys-on-surface-variant);
      }
    `,
  ],
})
export class SettingsPanel {
  readonly title = input.required<string>();
  readonly description = input<string>('');
}
