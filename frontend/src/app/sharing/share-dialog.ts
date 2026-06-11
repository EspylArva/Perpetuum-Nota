import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { forkJoin, switchMap } from 'rxjs';
import type { UserDto, Visibility } from '@stickynotes/shared';
import { NotesApi } from '../core/notes.api';
import { UsersApi } from '../core/users.api';

@Component({
  selector: 'app-share-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatRadioModule],
  template: `
    <div class="backdrop" (click)="cancel()">
      <div class="dialog" (click)="$event.stopPropagation()">
        <h2>Share note</h2>

        @if (loading()) {
          <p class="muted">Loading…</p>
        } @else {
          <mat-radio-group class="vis" [value]="visibility()" (change)="visibility.set($event.value)">
            <mat-radio-button value="PRIVATE">
              <b>Private</b> — only you and people you pick
            </mat-radio-button>
            <mat-radio-button value="PUBLIC">
              <b>Public</b> — any logged-in user can view
            </mat-radio-button>
          </mat-radio-group>

          <p class="lbl">Share with specific people</p>
          <div class="users">
            @for (u of users(); track u.id) {
              <mat-checkbox [checked]="isGranted(u.id)" (change)="toggle(u.id)">
                <span class="name">{{ u.displayName }}</span>
                <span class="email">{{ u.email }}</span>
              </mat-checkbox>
            } @empty {
              <p class="muted">No other users to share with yet.</p>
            }
          </div>
        }

        <div class="actions">
          <button matButton (click)="cancel()">Cancel</button>
          <button matButton="filled" [disabled]="saving() || loading()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
        </div>
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
        width: min(460px, 100%);
        background: var(--mat-sys-surface-container-high);
        color: var(--mat-sys-on-surface);
        border-radius: 16px;
        padding: 1.25rem 1.4rem;
        box-shadow: var(--mat-sys-level5);
      }
      h2 { margin: 0 0 0.9rem; font-size: 1.15rem; }
      .vis { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem; }
      .lbl {
        font-size: 0.8rem; font-weight: 700;
        color: var(--mat-sys-on-surface-variant);
        margin: 0 0 0.4rem;
      }
      .users { max-height: 240px; overflow: auto; display: flex; flex-direction: column; }
      .email { color: var(--mat-sys-on-surface-variant); font-size: 0.78rem; margin-left: 0.5rem; }
      .muted { color: var(--mat-sys-on-surface-variant); }
      .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.2rem; }
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
