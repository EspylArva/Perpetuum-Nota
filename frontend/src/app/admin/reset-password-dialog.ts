import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { UserAdminDto } from '@perpetuum-nota/shared';
import { UsersApi } from '../core/users.api';
import { generateTempPassword } from './password-gen';
import { ModalShell } from '../shared-ui/modal-shell';

@Component({
  selector: 'app-reset-password-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    ModalShell,
  ],
  template: `
    <app-modal-shell [width]="'440px'" (close)="cancel()">
        <h2>Reset password — {{ target().displayName }}</h2>

        @if (done()) {
          <p class="hint">Password reset. Copy it now — it will not be shown again.</p>
          <div class="copy-row">
            <code class="pw-display">{{ password }}</code>
            <button matIconButton matTooltip="Copy to clipboard" (click)="copy()">
              <mat-icon>content_copy</mat-icon>
            </button>
          </div>
          <div class="actions">
            <button matButton="filled" (click)="cancel()">Close</button>
          </div>
        } @else {
          <form (submit)="$event.preventDefault(); save()">
            <div class="pw-row">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="pw-field">
                <mat-label>New password (8+ characters)</mat-label>
                <input matInput type="text" name="password" [(ngModel)]="password"
                       autocomplete="new-password" />
              </mat-form-field>
              <button matButton type="button" (click)="generate()">Generate</button>
            </div>

            @if (error(); as e) {
              <p class="err">{{ e }}</p>
            }

            <div class="actions">
              <button matButton type="button" (click)="cancel()">Cancel</button>
              <button matButton="filled" type="submit" [disabled]="saving()">
                {{ saving() ? 'Saving…' : 'Reset password' }}
              </button>
            </div>
          </form>
        }
    </app-modal-shell>
  `,
  styles: [
    `
      h2 { margin: 0 0 0.9rem; font-size: var(--sn-text-xl); }
      .hint { font-size: var(--sn-text-sm); color: var(--mat-sys-on-surface-variant); margin: 0 0 0.6rem; }
      .pw-row { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.3rem; }
      .pw-field { flex: 1; }
      .copy-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.8rem; }
      .pw-display {
        flex: 1; font-family: monospace; font-size: var(--sn-text-md);
        background: var(--mat-sys-surface-container); padding: 0.4rem 0.6rem;
        border-radius: 6px; word-break: break-all;
      }
      .err { color: var(--mat-sys-error); font-size: var(--sn-text-sm); margin: 0.2rem 0 0; }
      .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.6rem; }
    `,
  ],
})
export class ResetPasswordDialog {
  readonly target = input.required<UserAdminDto>();
  readonly close = output<void>();

  private readonly api = inject(UsersApi);
  private readonly snack = inject(MatSnackBar);

  password = '';
  readonly saving = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  generate(): void {
    this.password = generateTempPassword();
  }

  save(): void {
    this.error.set(null);
    if (this.password.length < 8) {
      this.error.set('Password must be at least 8 characters.');
      return;
    }
    this.saving.set(true);
    this.api.resetPassword(this.target().id, this.password).subscribe({
      next: () => {
        this.saving.set(false);
        this.done.set(true);
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.message ?? 'Could not reset the password. Try again.');
      },
    });
  }

  copy(): void {
    navigator.clipboard.writeText(this.password).then(
      () => this.snack.open('Copied to clipboard.', undefined, { duration: 2000 }),
      () => this.snack.open('Couldn’t copy — select and copy manually.', undefined, { duration: 3000 }),
    );
  }

  cancel(): void {
    this.close.emit();
  }
}
