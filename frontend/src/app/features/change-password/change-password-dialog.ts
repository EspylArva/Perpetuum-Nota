import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-change-password-dialog',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="backdrop" (click)="cancel()">
      <div class="dialog" (click)="$event.stopPropagation()">
        <h2>Change password</h2>

        @if (done()) {
          <p class="ok">Password changed.</p>
          <div class="actions">
            <button matButton="filled" (click)="cancel()">Close</button>
          </div>
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
              <button matButton type="button" (click)="cancel()">Cancel</button>
              <button matButton="filled" type="submit" [disabled]="saving()">
                {{ saving() ? 'Saving…' : 'Change password' }}
              </button>
            </div>
          </form>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed; inset: 0;
        background: color-mix(in srgb, var(--mat-sys-scrim) 45%, transparent);
        display: grid; place-items: center; z-index: 60; padding: 1.5rem;
      }
      .dialog {
        width: min(400px, 100%);
        background: var(--mat-sys-surface-container-high);
        color: var(--mat-sys-on-surface);
        border-radius: 16px;
        padding: 1.25rem 1.4rem;
        box-shadow: var(--mat-sys-level5);
      }
      h2 { margin: 0 0 0.9rem; font-size: 1.15rem; }
      mat-form-field { margin-bottom: 0.3rem; }
      .err { color: var(--mat-sys-error); font-size: 0.82rem; margin: 0.2rem 0 0; }
      .ok { color: var(--mat-sys-tertiary); font-size: 0.9rem; }
      .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.6rem; }
    `,
  ],
})
export class ChangePasswordDialog {
  readonly close = output<void>();

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

  cancel(): void {
    this.close.emit();
  }
}
