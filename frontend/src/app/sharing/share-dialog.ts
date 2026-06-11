import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { forkJoin, switchMap } from 'rxjs';
import type { UserDto, Visibility } from '@stickynotes/shared';
import { NotesApi } from '../core/notes.api';
import { UsersApi } from '../core/users.api';

@Component({
  selector: 'app-share-dialog',
  imports: [],
  template: `
    <div class="backdrop" (click)="cancel()">
      <div class="dialog" (click)="$event.stopPropagation()">
        <h2>Share note</h2>

        @if (loading()) {
          <p class="muted">Loading…</p>
        } @else {
          <div class="vis">
            <label>
              <input type="radio" name="vis" [checked]="visibility() === 'PRIVATE'"
                     (change)="visibility.set('PRIVATE')" />
              <span><b>Private</b> — only you and people you pick</span>
            </label>
            <label>
              <input type="radio" name="vis" [checked]="visibility() === 'PUBLIC'"
                     (change)="visibility.set('PUBLIC')" />
              <span><b>Public</b> — any logged-in user can view</span>
            </label>
          </div>

          <p class="lbl">Share with specific people</p>
          <div class="users">
            @for (u of users(); track u.id) {
              <label class="u">
                <input type="checkbox" [checked]="isGranted(u.id)" (change)="toggle(u.id)" />
                <span class="name">{{ u.displayName }}</span>
                <span class="email">{{ u.email }}</span>
              </label>
            } @empty {
              <p class="muted">No other users to share with yet.</p>
            }
          </div>
        }

        <div class="actions">
          <button class="ghost" (click)="cancel()">Cancel</button>
          <button class="primary" [disabled]="saving() || loading()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop { position: fixed; inset: 0; background: rgba(40,35,10,0.45); display: grid; place-items: center; z-index: 60; padding: 1.5rem; }
      .dialog { width: min(440px, 100%); background: #fffdf3; border-radius: 12px; padding: 1.25rem 1.4rem; box-shadow: 0 24px 60px rgba(0,0,0,0.35); }
      h2 { margin: 0 0 0.9rem; font-size: 1.15rem; color: #2f2b1a; }
      .vis { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
      .vis label, .u { display: flex; gap: 0.5rem; align-items: baseline; font-size: 0.9rem; color: #3a3520; cursor: pointer; }
      .lbl { font-size: 0.8rem; font-weight: 700; color: #6f6638; margin: 0 0 0.4rem; }
      .users { max-height: 220px; overflow: auto; display: flex; flex-direction: column; gap: 0.4rem; }
      .u .email { color: #a99f6e; font-size: 0.78rem; }
      .muted { color: #a99f6e; }
      .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.2rem; }
      .ghost { border: 1px solid #cbb94f; border-radius: 8px; padding: 0.45rem 0.9rem; background: transparent; color: #6f6638; cursor: pointer; }
      .primary { border: none; border-radius: 8px; padding: 0.45rem 1rem; background: #f0c808; color: #2f2b1a; font-weight: 700; cursor: pointer; }
      .primary:disabled { opacity: 0.6; }
    `,
  ],
})
export class ShareDialog implements OnInit {
  readonly noteId = input.required<string>();
  readonly close = output<void>();

  private readonly notesApi = inject(NotesApi);
  private readonly usersApi = inject(UsersApi);

  readonly users = signal<UserDto[]>([]);
  readonly visibility = signal<Visibility>('PRIVATE');
  private readonly granted = signal<ReadonlySet<string>>(new Set());
  readonly loading = signal(true);
  readonly saving = signal(false);

  ngOnInit(): void {
    forkJoin({
      users: this.usersApi.list(),
      shares: this.notesApi.getShares(this.noteId()),
    }).subscribe(({ users, shares }) => {
      this.users.set(users);
      this.visibility.set(shares.visibility);
      this.granted.set(new Set(shares.sharedWith.map((u) => u.id)));
      this.loading.set(false);
    });
  }

  isGranted(id: string): boolean {
    return this.granted().has(id);
  }

  toggle(id: string): void {
    this.granted.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  save(): void {
    this.saving.set(true);
    this.notesApi
      .setVisibility(this.noteId(), this.visibility())
      .pipe(
        switchMap(() => this.notesApi.setShares(this.noteId(), [...this.granted()])),
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.close.emit();
        },
        error: () => this.saving.set(false),
      });
  }

  cancel(): void {
    this.close.emit();
  }
}
