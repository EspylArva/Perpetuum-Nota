import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Role, UserAdminDto } from '@stickynotes/shared';
import { UsersApi } from '../core/users.api';

@Component({
  selector: 'app-admin-users',
  imports: [FormsModule, RouterLink],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.scss',
})
export class AdminUsers implements OnInit {
  private readonly api = inject(UsersApi);

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
    this.error.set(null);
    this.api.update(u.id, { isActive }).subscribe({
      next: (updated) =>
        this.users.update((list) =>
          list.map((x) => (x.id === u.id ? updated : x)),
        ),
      error: (e) => this.onUpdateError(e),
    });
  }

  setRole(u: UserAdminDto, role: Role): void {
    this.error.set(null);
    this.api.update(u.id, { role }).subscribe({
      next: (updated) =>
        this.users.update((list) =>
          list.map((x) => (x.id === u.id ? updated : x)),
        ),
      error: (e) => this.onUpdateError(e),
    });
  }

  private onUpdateError(e: { error?: { message?: string } }): void {
    this.error.set(e?.error?.message ?? 'Could not update the user.');
    this.refresh(); // revert the select/row to server state
  }
}
