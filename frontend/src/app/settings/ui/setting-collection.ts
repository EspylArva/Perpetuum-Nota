import { Component, input, output } from '@angular/core';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { SettingRow } from './setting-row';

/**
 * Collection setting (a list/set of strings) rendered as editable chips: type +
 * Enter to add, "x" to remove. Future-ready — emits intent; the parent owns the
 * data. (Not yet wired to an existing setting.)
 */
@Component({
  selector: 'app-setting-collection',
  imports: [SettingRow, MatChipsModule, MatIconModule],
  template: `
    <app-setting-row [label]="label()" [description]="description()">
      <mat-chip-grid #grid [attr.aria-label]="label()">
        @for (item of items(); track item) {
          <mat-chip-row (removed)="remove.emit(item)">
            {{ item }}
            <button matChipRemove [attr.aria-label]="'Remove ' + item">
              <mat-icon>cancel</mat-icon>
            </button>
          </mat-chip-row>
        }
        <input
          [placeholder]="placeholder()"
          [matChipInputFor]="grid"
          (matChipInputTokenEnd)="onAdd($event)"
        />
      </mat-chip-grid>
    </app-setting-row>
  `,
})
export class SettingCollection {
  readonly label = input.required<string>();
  readonly description = input<string>('');
  readonly items = input.required<readonly string[]>();
  readonly placeholder = input<string>('Add…');
  readonly add = output<string>();
  readonly remove = output<string>();

  onAdd(event: MatChipInputEvent): void {
    const value = event.value.trim();
    if (value) this.add.emit(value);
    event.chipInput.clear();
  }
}
