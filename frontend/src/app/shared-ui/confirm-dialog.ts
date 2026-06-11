import { Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { Observable } from 'rxjs';

export interface ConfirmData {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Renders the confirm button in the error color for destructive actions. */
  destructive?: boolean;
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      <button
        matButton="filled"
        [class.destructive]="data.destructive"
        [mat-dialog-close]="true"
        cdkFocusInitial
      >
        {{ data.confirmLabel ?? 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .destructive {
        --mat-button-filled-container-color: var(--mat-sys-error);
        --mat-button-filled-label-text-color: var(--mat-sys-on-error);
      }
    `,
  ],
})
export class ConfirmDialog {
  readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}

/** Opens a Material confirm dialog; emits true only on explicit confirmation. */
export function openConfirm(
  dialog: MatDialog,
  data: ConfirmData,
): Observable<boolean | undefined> {
  return dialog
    .open<ConfirmDialog, ConfirmData, boolean>(ConfirmDialog, {
      data,
      width: '380px',
      autoFocus: false,
    })
    .afterClosed();
}
