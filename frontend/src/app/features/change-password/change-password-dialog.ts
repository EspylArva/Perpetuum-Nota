import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-change-password-dialog',
  imports: [FormsModule],
  template: `
    <div class="backdrop" (click)="cancel()">
      <div class="dialog" (click)="$event.stopPropagation()">
        <h2>Change password</h2>

        @if (done()) {
          <p class="ok">Password changed.</p>
          <div class="actions">
            <button class="primary" (click)="cancel()">Close</button>
          </div>
        } @else {
          <form (submit)="$event.preventDefault(); save()">
            <label>
              Current password
              <input type="password" name="current" [(ngModel)]="current" autocomplete="current-password" />
            </label>
            <label>
              New password (6+ characters)
              <input type="password" name="next" [(ngModel)]="next" autocomplete="new-password" />
            </label>
            <label>
              Confirm new password
              <input type="password" name="confirm" [(ngModel)]="confirm" autocomplete="new-password" />
            </label>

            @if (error(); as e) {
              <p class="err">{{ e }}</p>
            }

            <div class="actions">
              <button type="button" class="ghost" (click)="cancel()">Cancel</button>
              <button type="submit" class="primary" [disabled]="saving()">
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
      .backdrop { position: fixed; inset: 0; background: rgba(40,35,10,0.45); display: grid; place-items: center; z-index: 60; padding: 1.5rem; }
      .dialog { width: min(380px, 100%); background: #fffdf3; border-radius: 12px; padding: 1.25rem 1.4rem; box-shadow: 0 24px 60px rgba(0,0,0,0.35); }
      h2 { margin: 0 0 0.9rem; font-size: 1.15rem; color: #2f2b1a; }
      label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; font-weight: 600; color: #6f6638; margin-bottom: 0.7rem; }
      input { border: 1px solid #d9cd72; border-radius: 8px; padding: 0.45rem 0.6rem; font-size: 0.9rem; background: #fffdf0; outline: none; }
      input:focus { border-color: #f0c808; }
      .err { color: #b8431f; font-size: 0.82rem; margin: 0.2rem 0 0; }
      .ok { color: #1d6b1d; font-size: 0.9rem; }
      .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
      .ghost { border: 1px solid #cbb94f; border-radius: 8px; padding: 0.45rem 0.9rem; background: transparent; color: #6f6638; cursor: pointer; }
      .primary { border: none; border-radius: 8px; padding: 0.45rem 1rem; background: #f0c808; color: #2f2b1a; font-weight: 700; cursor: pointer; }
      .primary:disabled { opacity: 0.6; }
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
