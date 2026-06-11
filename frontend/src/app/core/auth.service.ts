import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import type { UserDto } from '@stickynotes/shared';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly _user = signal<UserDto | null>(null);
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  login(email: string, password: string): Observable<UserDto> {
    return this.http
      .post<UserDto>('/api/auth/login', { email, password })
      .pipe(tap((u) => this._user.set(u)));
  }

  /** Hydrates currentUser from the session cookie; errors if not authenticated. */
  me(): Observable<UserDto> {
    return this.http
      .get<UserDto>('/api/auth/me')
      .pipe(tap((u) => this._user.set(u)));
  }

  logout(): Observable<unknown> {
    return this.http
      .post('/api/auth/logout', {})
      .pipe(tap(() => this._user.set(null)));
  }
}
