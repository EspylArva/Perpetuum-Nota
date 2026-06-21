import { Component, input, output } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SettingRow } from './setting-row';

/**
 * String setting (single-line text/password/email input). Emits on change/blur
 * (not per-keystroke). Future-ready — not yet wired to an existing setting.
 */
@Component({
  selector: 'app-setting-text',
  imports: [SettingRow, MatFormFieldModule, MatInputModule],
  template: `
    <app-setting-row [label]="label()" [description]="description()">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <input
          matInput
          [type]="type()"
          [value]="value()"
          [placeholder]="placeholder()"
          [attr.aria-label]="label()"
          (change)="valueChange.emit($any($event.target).value)"
        />
      </mat-form-field>
    </app-setting-row>
  `,
})
export class SettingText {
  readonly label = input.required<string>();
  readonly description = input<string>('');
  readonly value = input.required<string>();
  readonly placeholder = input<string>('');
  readonly type = input<'text' | 'password' | 'email'>('text');
  readonly valueChange = output<string>();
}
