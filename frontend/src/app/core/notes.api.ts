import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  NoteDto,
  NoteFilter,
  NoteSharesDto,
  NoteSummaryDto,
  Visibility,
} from '@stickynotes/shared';

@Injectable({ providedIn: 'root' })
export class NotesApi {
  private readonly http = inject(HttpClient);

  list(filter: NoteFilter = 'all'): Observable<NoteSummaryDto[]> {
    return this.http.get<NoteSummaryDto[]>(`/api/notes?filter=${filter}`);
  }

  create(title?: string): Observable<NoteSummaryDto> {
    return this.http.post<NoteSummaryDto>('/api/notes', { title });
  }

  get(id: string): Observable<NoteDto> {
    return this.http.get<NoteDto>(`/api/notes/${id}`);
  }

  updateContent(
    id: string,
    content: unknown,
  ): Observable<{ contentUpdatedAt: string }> {
    return this.http.patch<{ contentUpdatedAt: string }>(
      `/api/notes/${id}/content`,
      { content },
    );
  }

  updateMeta(id: string, title: string): Observable<NoteSummaryDto> {
    return this.http.patch<NoteSummaryDto>(`/api/notes/${id}`, { title });
  }

  remove(id: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`/api/notes/${id}`);
  }

  batchDelete(ids: string[]): Observable<{ deleted: string[] }> {
    return this.http.post<{ deleted: string[] }>('/api/notes/batch-delete', {
      ids,
    });
  }

  reorder(orderedIds: string[]): Observable<{ updated: string[] }> {
    return this.http.post<{ updated: string[] }>('/api/notes/reorder', {
      orderedIds,
    });
  }

  getShares(id: string): Observable<NoteSharesDto> {
    return this.http.get<NoteSharesDto>(`/api/notes/${id}/shares`);
  }

  setShares(id: string, userIds: string[]): Observable<NoteSharesDto> {
    return this.http.put<NoteSharesDto>(`/api/notes/${id}/shares`, { userIds });
  }

  setVisibility(
    id: string,
    visibility: Visibility,
  ): Observable<{ visibility: Visibility }> {
    return this.http.patch<{ visibility: Visibility }>(
      `/api/notes/${id}/visibility`,
      { visibility },
    );
  }
}
