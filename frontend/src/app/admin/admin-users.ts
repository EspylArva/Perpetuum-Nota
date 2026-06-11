import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { Role, UserAdminDto } from '@stickynotes/shared';
import { UsersApi } from '../core/users.api';
import { openConfirm } from '../shared-ui/confirm-dialog';

@Component({
  selector: 'app-admin-users',
  imports: [
    FormsModule,
    RouterLink,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.scss',
})
export class AdminUsers implements OnInit {
  private readonly api = inject(UsersApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  readonly users = signal<UserAdminDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly creating = signal(false);

  // create form
  email = '';
  displayName = '';
  password = '';
  role: Role = 'USER';

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.listAll().subscribe((u) => this.users.set(u));
  }

  create(): void {
    this.error.set(null);
    if (!this.email || !this.displayName || this.password.length < 6) {
      this.error.set('Email, name, and a 6+ char password are required.');
      return;
    }
    this.creating.set(true);
    this.api
      .create({
        email: this.email,
        displayName: this.displayName,
        password: this.password,
        role: this.role,
      })
      .subscribe({
        next: (u) => {
          this.users.update((list) => [...list, u]);
          this.email = '';
          this.displayName = '';
          this.password = '';
          this.role = 'USER';
          this.creating.set(false);
        },
        error: (e) => {
          this.error.set(
            e?.error?.message ?? 'Could not create user (email may be in use).',
          );
          this.creating.set(false);
        },
      });
  }

  setActive(u: UserAdminDto, isActive: boolean): void {
    this.api.update(u.id, { isActive }).subscribe({
      next: (updated) =>
        this.users.update((list) =>
          list.map((x) => (x.id === u.id ? updated : x)),
        ),
      error: (e) => this.onUpdateError(e),
    });
  }

  setRole(u: UserAdminDto, role: Role): void {
    this.api.update(u.id, { role }).subscribe({
      next: (updated) =>
        this.users.update((list) =>
          list.map((x) => (x.id === u.id ? updated : x)),
        ),
      error: (e) => this.onUpdateError(e),
    });
  }

  deleteUser(u: UserAdminDto): void {
    openConfirm(this.dialog, {
      title: `Delete ${u.displayName}?`,
      message: `This permanently deletes ${u.email} together with ALL their notes, images, and shares. It cannot be undone.`,
      confirmLabel: 'Delete user',
      destructive: true,
    }).subscribe((ok) => {
      if (!ok) return;
      this.api.remove(u.id).subscribe({
        next: () => {
          this.users.update((list) => list.filter((x) => x.id !== u.id));
          this.snack.open(`${u.email} deleted.`, undefined, { duration: 3000 });
        },
        error: (e) => this.onUpdateError(e),
      });
    });
  }

  private onUpdateError(e: { error?: { message?: string } }): void {
    this.snack.open(
      e?.error?.message ?? 'Could not update the user.',
      'Dismiss',
      { duration: 5000 },
    );
    this.refresh(); // revert the control to server state
  }
}
