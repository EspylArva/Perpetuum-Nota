import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';

export interface NameDialogData {
  title: string;
  label: string;
  /** Prefilled value for the input (e.g. the current name when renaming). */
  initial?: string;
  /** Confirm button label (default "Save"). */
  confirmText?: string;
}

@Component({
  selector: 'app-name-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <form (submit)="$event.preventDefault(); confirm()">
        <mat-form-field appearance="outline">
          <mat-label>{{ data.label }}</mat-label>
          <input
            matInput
            name="name"
            [(ngModel)]="name"
            cdkFocusInitial
            autocomplete="off"
          />
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton [mat-dialog-close]="null">Cancel</button>
      <button
        matButton="filled"
        type="button"
        [disabled]="!name().trim()"
        (click)="confirm()"
      >
        {{ data.confirmText ?? 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      mat-form-field {
        width: 100%;
      }
    `,
  ],
})
export class NameDialog {
  readonly data = inject<NameDialogData>(MAT_DIALOG_DATA);
  private readonly ref =
    inject<MatDialogRef<NameDialog, string | null>>(MatDialogRef);

  readonly name = signal(this.data.initial ?? '');

  confirm(): void {
    const trimmed = this.name().trim();
    if (!trimmed) return; // empty/whitespace: no-op (button is also disabled)
    this.ref.close(trimmed);
  }
}

/**
 * Opens a Material name-entry dialog. Resolves to the trimmed name on confirm,
 * or null on cancel/dismiss. Mirrors the openConfirm helper but returns a
 * Promise for easy `await` in the caller.
 */
export function openNameDialog(
  dialog: MatDialog,
  data: NameDialogData,
): Promise<string | null> {
  const ref = dialog.open<NameDialog, NameDialogData, string | null>(
    NameDialog,
    {
      data,
      width: '380px',
      autoFocus: false,
    },
  );
  // afterClosed emits the close() value (trimmed name) or undefined on a
  // backdrop/Esc dismiss — normalise both "no value" cases to null.
  return firstValueFrom(ref.afterClosed()).then((result) => result ?? null);
}
