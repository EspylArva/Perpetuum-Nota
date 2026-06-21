import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth.service';

/**
 * Inline "change password" form (no dialog/backdrop) for the Settings → Account
 * section. Same logic as the former dialog: current / new / confirm with ≥6-char
 * + match validation, mapping a 401 to a clear message, and an inline success
 * state with a "Change again" reset.
 */
@Component({
  selector: 'app-change-password-form',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    @if (done()) {
      <p class="ok">Password changed.</p>
      <button matButton (click)="reset()">Change again</button>
    } @else {
      <form (submit)="$event.preventDefault(); save()">
        <mat-form-field appearance="outline">
          <mat-label>Current password</mat-label>
          <input matInput type="password" name="current" [(ngModel)]="current" autocomplete="current-password" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>New password (6+ characters)</mat-label>
          <input matInput type="password" name="next" [(ngModel)]="next" autocomplete="new-password" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Confirm new password</mat-label>
          <input matInput type="password" name="confirm" [(ngModel)]="confirm" autocomplete="new-password" />
        </mat-form-field>

        @if (error(); as e) {
          <p class="err">{{ e }}</p>
        }

        <div class="actions">
          <button matButton="filled" type="submit" [disabled]="saving()">
            {{ saving() ? 'Saving…' : 'Change password' }}
          </button>
        </div>
      </form>
    }
  `,
  styles: [
    `
      :host { display: block; }
      form { display: flex; flex-direction: column; }
      mat-form-field { width: min(420px, 100%); margin-bottom: 0.3rem; }
      .err { color: var(--mat-sys-error); font-size: var(--sn-text-sm); margin: 0.2rem 0 0; }
      .ok { color: var(--mat-sys-tertiary); font-size: var(--sn-text-base); margin: 0 0 0.5rem; }
      .actions { display: flex; gap: 0.5rem; margin-top: 0.4rem; }
    `,
  ],
})
export class ChangePasswordForm {
  private readonly auth = inject(AuthService);

  current = '';
  next = '';
  confirm = '';
  readonly saving = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  save(): void {
    this.error.set(null);
    if (this.next.length < 6) {
      this.error.set('New password must be at least 6 characters.');
      return;
    }
    if (this.next !== this.confirm) {
      this.error.set('New passwords do not match.');
      return;
    }
    this.saving.set(true);
    this.auth.changePassword(this.current, this.next).subscribe({
      next: () => {
        this.saving.set(false);
        this.done.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(
          err?.status === 401
            ? 'Current password is incorrect.'
            : 'Could not change the password. Try again.',
        );
      },
    });
  }

  reset(): void {
    this.current = '';
    this.next = '';
    this.confirm = '';
    this.error.set(null);
    this.done.set(false);
  }
}
