import { Component, input, output } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { SettingRow } from './setting-row';

export interface SettingOption {
  value: string;
  label: string;
  /** Optional trailing hint shown after the label (e.g. a format example). */
  hint?: string;
}

/**
 * Dropdown setting. String-valued (callers cast to their own string-union enum,
 * e.g. `setThemeName($event as ThemeName)`) to keep template typing simple.
 */
@Component({
  selector: 'app-setting-select',
  imports: [SettingRow, MatFormFieldModule, MatSelectModule],
  template: `
    <app-setting-row [label]="label()" [description]="description()">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-select
          [value]="value()"
          (selectionChange)="valueChange.emit($event.value)"
          [attr.aria-label]="label()"
        >
          @for (o of options(); track o.value) {
            <mat-option [value]="o.value">
              {{ o.label }}{{ o.hint ? ' — ' + o.hint : '' }}
            </mat-option>
          }
        </mat-select>
      </mat-form-field>
    </app-setting-row>
  `,
})
export class SettingSelect {
  readonly label = input.required<string>();
  readonly description = input<string>('');
  readonly options = input.required<readonly SettingOption[]>();
  readonly value = input.required<string>();
  readonly valueChange = output<string>();
}
