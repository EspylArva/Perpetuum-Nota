import { Component, input } from '@angular/core';

/**
 * One labeled setting on its OWN row: a label (+ optional helper text) on the
 * left and the projected control on the right (wrapping below on narrow widths).
 * The building block every typed setting field composes.
 */
@Component({
  selector: 'app-setting-row',
  template: `
    <div class="setting-row">
      <div class="setting-label">
        <span class="setting-name">{{ label() }}</span>
        @if (description()) {
          <span class="setting-desc">{{ description() }}</span>
        }
      </div>
      <div class="setting-control">
        <ng-content />
      </div>
    </div>
  `,
  styles: [
    `
      /* Each row sits on its own line with a hairline separating it from the
         row (or panel description) above. */
      .setting-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem 1.25rem;
        padding: 0.7rem 0;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
      .setting-label {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        min-width: 0;
        flex: 1 1 220px;
      }
      .setting-name { font-size: var(--sn-text-base); font-weight: 500; }
      .setting-desc {
        font-size: var(--sn-text-sm);
        color: var(--mat-sys-on-surface-variant);
      }
      .setting-control {
        flex: 0 1 auto;
        display: flex;
        align-items: center;
        min-width: 0;
      }
      /* Selects/inputs get a sensible fixed-ish width; toggles size to content. */
      .setting-control ::ng-deep mat-form-field { width: 240px; max-width: 100%; }
    `,
  ],
})
export class SettingRow {
  readonly label = input.required<string>();
  readonly description = input<string>('');
}
