import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { FolderDto } from '@perpetuum-nota/shared';

@Injectable({ providedIn: 'root' })
export class FoldersApi {
  private readonly http = inject(HttpClient);

  /** The caller's folders as a flat list with direct live-note counts. */
  list(): Observable<FolderDto[]> {
    return this.http.get<FolderDto[]>('/api/folders');
  }

  create(name: string, parentId?: string | null): Observable<FolderDto> {
    return this.http.post<FolderDto>('/api/folders', {
      name,
      ...(parentId !== undefined ? { parentId } : {}),
    });
  }

  /** Rename, move, and/or reposition on the wall in a single PATCH. */
  update(
    id: string,
    patch: {
      name?: string;
      parentId?: string | null;
      wallX?: number;
      wallY?: number;
    },
  ): Observable<FolderDto> {
    return this.http.patch<FolderDto>(`/api/folders/${id}`, patch);
  }

  rename(id: string, name: string): Observable<FolderDto> {
    return this.update(id, { name });
  }

  move(id: string, parentId: string | null): Observable<FolderDto> {
    return this.update(id, { parentId });
  }

  /** Persists a folder card's wall grid position. */
  moveOnWall(id: string, wallX: number, wallY: number): Observable<FolderDto> {
    return this.update(id, { wallX, wallY });
  }

  remove(id: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`/api/folders/${id}`);
  }
}
