import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import type { UserDto } from '@perpetuum-nota/shared';
import { OpenNotesStore } from '../editor/open-notes.store';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly openNotes = inject(OpenNotesStore);

  private readonly _user = signal<UserDto | null>(null);
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  login(email: string, password: string): Observable<UserDto> {
    return this.http.post<UserDto>('/api/auth/login', { email, password }).pipe(
      tap((u) => {
        // Never serve another account's cached note state.
        this.openNotes.clear();
        this.clearOpenTabs();
        this._user.set(u);
      }),
    );
  }

  /** Hydrates currentUser from the session cookie; errors if not authenticated. */
  me(): Observable<UserDto> {
    return this.http
      .get<UserDto>('/api/auth/me')
      .pipe(tap((u) => this._user.set(u)));
  }

  logout(): Observable<unknown> {
    return this.http.post('/api/auth/logout', {}).pipe(
      tap(() => {
        this.openNotes.clear();
        this.clearOpenTabs();
        this._user.set(null);
      }),
    );
  }

  /**
   * Drops the persisted LIST tab set (the Manager's open-notes tabs, keyed
   * `sticky.openTabs` in localStorage). Cleared alongside the OpenNotesStore on
   * login/logout so one account never restores another's open notes; a plain
   * reload (which calls `me()`, not this) keeps them.
   */
  private clearOpenTabs(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('sticky.openTabs');
    }
  }

  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>('/api/auth/change-password', {
      currentPassword,
      newPassword,
    });
  }
}
