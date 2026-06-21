import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { forkJoin, switchMap } from 'rxjs';
import type { ShareGrantDto, UserDto, Visibility } from '@perpetuum-nota/shared';
import { NotesApi } from '../core/notes.api';
import { UsersApi } from '../core/users.api';
import { ModalShell } from '../shared-ui/modal-shell';

@Component({
  selector: 'app-share-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatRadioModule, ModalShell],
  template: `
    <app-modal-shell (close)="cancel()">
        <h2>Share note</h2>

        @if (loading()) {
          <p class="muted">Loading…</p>
        } @else {
          <mat-radio-group class="vis" [value]="visibility()" (change)="visibility.set($event.value)">
            <mat-radio-button value="PRIVATE">
              <b>Private</b> — only you and people you pick
            </mat-radio-button>
            <mat-radio-button value="PUBLIC">
              <b>Public</b> — any logged-in user can view <em>and edit</em>
            </mat-radio-button>
          </mat-radio-group>

          @if (visibility() === 'PUBLIC') {
            <p class="note">Public notes are editable by everyone, so the
              per-person access below doesn't apply while a note is public.</p>
          }

          <p class="lbl">Share with specific people</p>
          <div class="users" [class.dimmed]="visibility() === 'PUBLIC'">
            @for (u of users(); track u.id) {
              <div class="user">
                <mat-checkbox [checked]="isGranted(u.id)" (change)="toggle(u.id)">
                  <span class="name">{{ u.displayName }}</span>
                  <span class="email">{{ u.email }}</span>
                </mat-checkbox>
                @if (isGranted(u.id)) {
                  <mat-radio-group
                    class="level"
                    [value]="canEdit(u.id) ? 'edit' : 'view'"
                    (change)="setLevel(u.id, $event.value)"
                  >
                    <mat-radio-button value="view">Read-only</mat-radio-button>
                    <mat-radio-button value="edit">Can edit</mat-radio-button>
                  </mat-radio-group>
                }
              </div>
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
    </app-modal-shell>
  `,
  styles: [
    `
      h2 { margin: 0 0 0.9rem; font-size: var(--sn-text-xl); }
      .vis { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.6rem; }
      .vis em { font-style: italic; opacity: 0.85; }
      .note {
        font-size: var(--sn-text-sm); margin: 0 0 0.8rem;
        color: var(--mat-sys-on-surface-variant);
      }
      .lbl {
        font-size: var(--sn-text-sm); font-weight: 700;
        color: var(--mat-sys-on-surface-variant);
        margin: 0 0 0.4rem;
      }
      .users { max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 0.15rem; }
      .users.dimmed { opacity: 0.5; pointer-events: none; }
      .user { display: flex; flex-direction: column; padding: 0.1rem 0; }
      .email { color: var(--mat-sys-on-surface-variant); font-size: var(--sn-text-xs); margin-left: 0.5rem; }
      .level { display: flex; gap: 1rem; margin: 0 0 0.2rem 2rem; }
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
  // Granted users → whether the grant allows editing. Absence = not shared.
  private readonly grants = signal<ReadonlyMap<string, boolean>>(new Map());
  readonly loading = signal(true);
  readonly saving = signal(false);

  ngOnInit(): void {
    forkJoin({
      users: this.usersApi.list(),
      shares: this.notesApi.getShares(this.noteId()),
    }).subscribe(({ users, shares }) => {
      this.users.set(users);
      this.visibility.set(shares.visibility);
      this.grants.set(new Map(shares.sharedWith.map((u) => [u.id, u.canEdit])));
      this.loading.set(false);
    });
  }

  isGranted(id: string): boolean {
    return this.grants().has(id);
  }

  canEdit(id: string): boolean {
    return this.grants().get(id) === true;
  }

  toggle(id: string): void {
    this.grants.update((map) => {
      const next = new Map(map);
      if (next.has(id)) next.delete(id);
      else next.set(id, false); // new grants default to read-only
      return next;
    });
  }

  setLevel(id: string, level: 'view' | 'edit'): void {
    this.grants.update((map) => {
      const next = new Map(map);
      if (next.has(id)) next.set(id, level === 'edit');
      return next;
    });
  }

  save(): void {
    this.saving.set(true);
    const grants: ShareGrantDto[] = [...this.grants()].map(([userId, edit]) => ({
      userId,
      canEdit: edit,
    }));
    this.notesApi
      .setVisibility(this.noteId(), this.visibility())
      .pipe(switchMap(() => this.notesApi.setShares(this.noteId(), grants)))
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
