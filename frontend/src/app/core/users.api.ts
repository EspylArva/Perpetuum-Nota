import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateUserDto,
  UpdateUserDto,
  UserAdminDto,
  UserDto,
} from '@stickynotes/shared';

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);

  /** Active users for the share picker. */
  list(): Observable<UserDto[]> {
    return this.http.get<UserDto[]>('/api/users');
  }

  /** Admin: full user list. */
  listAll(): Observable<UserAdminDto[]> {
    return this.http.get<UserAdminDto[]>('/api/users/manage');
  }

  /** Admin: create a user. */
  create(dto: CreateUserDto): Observable<UserAdminDto> {
    return this.http.post<UserAdminDto>('/api/users', dto);
  }

  /** Admin: update role / active / display name. */
  update(id: string, dto: UpdateUserDto): Observable<UserAdminDto> {
    return this.http.patch<UserAdminDto>(`/api/users/${id}`, dto);
  }

  /** Admin: permanently delete a user and all their data. */
  remove(id: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`/api/users/${id}`);
  }
}
