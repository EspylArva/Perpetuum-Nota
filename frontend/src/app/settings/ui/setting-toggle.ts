import { Component, input, output } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SettingRow } from './setting-row';

/** Boolean setting (on/off slide toggle). */
@Component({
  selector: 'app-setting-toggle',
  imports: [SettingRow, MatSlideToggleModule],
  template: `
    <app-setting-row [label]="label()" [description]="description()">
      <mat-slide-toggle
        [checked]="checked()"
        (change)="checkedChange.emit($event.checked)"
        [attr.aria-label]="label()"
      />
    </app-setting-row>
  `,
})
export class SettingToggle {
  readonly label = input.required<string>();
  readonly description = input<string>('');
  readonly checked = input.required<boolean>();
  readonly checkedChange = output<boolean>();
}
