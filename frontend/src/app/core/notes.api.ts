import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ImportNoteDto,
  ImportNotesResultDto,
  NoteDto,
  NoteFilter,
  NoteGraphDto,
  NoteSharesDto,
  NoteSort,
  NoteSummaryDto,
  NotesExportDto,
  ShareGrantDto,
  SharedBadgeDto,
  Visibility,
} from '@perpetuum-nota/shared';

/** Which scopes of notes to include in an export (Settings → Account). */
export interface ExportScopes {
  mine: boolean;
  shared: boolean;
  public: boolean;
}

export interface ListQuery {
  filter?: NoteFilter;
  q?: string;
  tag?: string;
  sort?: NoteSort;
  // inclusive due-date window as ISO strings (client computes local-day bounds)
  dueAfter?: string;
  dueBefore?: string;
  // organizational folder filter — notes directly in this folder
  folderId?: string;
}

@Injectable({ providedIn: 'root' })
export class NotesApi {
  private readonly http = inject(HttpClient);

  list(query: ListQuery = {}): Observable<NoteSummaryDto[]> {
    let params = new HttpParams().set('filter', query.filter ?? 'all');
    if (query.q) params = params.set('q', query.q);
    if (query.tag) params = params.set('tag', query.tag);
    if (query.sort && query.sort !== 'position') {
      params = params.set('sort', query.sort);
    }
    if (query.dueAfter) params = params.set('dueAfter', query.dueAfter);
    if (query.dueBefore) params = params.set('dueBefore', query.dueBefore);
    if (query.folderId) params = params.set('folderId', query.folderId);
    return this.http.get<NoteSummaryDto[]>('/api/notes', { params });
  }

  sharedBadge(): Observable<SharedBadgeDto> {
    return this.http.get<SharedBadgeDto>('/api/notes/shared-badge');
  }

  /** Wikilink graph (viewable nodes + undirected edges) for the graph view. */
  graph(): Observable<NoteGraphDto> {
    return this.http.get<NoteGraphDto>('/api/notes/graph');
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
    baseContentUpdatedAt?: string | null,
  ): Observable<{ contentUpdatedAt: string; links: { id: string; title: string }[] }> {
    return this.http.patch<{
      contentUpdatedAt: string;
      links: { id: string; title: string }[];
    }>(
      `/api/notes/${id}/content`,
      baseContentUpdatedAt ? { content, baseContentUpdatedAt } : { content },
    );
  }

  updateMeta(
    id: string,
    patch: {
      title?: string;
      pinned?: boolean;
      wallX?: number;
      wallY?: number;
      // ISO string sets the due date; null clears it
      dueDate?: string | null;
      // folder id files the note; null clears it (move to root)
      folderId?: string | null;
    },
  ): Observable<NoteSummaryDto> {
    return this.http.patch<NoteSummaryDto>(`/api/notes/${id}`, patch);
  }

  /** Soft delete — moves the note to trash. */
  remove(id: string): Observable<{ id: string; deletedAt: string }> {
    return this.http.delete<{ id: string; deletedAt: string }>(
      `/api/notes/${id}`,
    );
  }

  restore(id: string): Observable<NoteSummaryDto> {
    return this.http.post<NoteSummaryDto>(`/api/notes/${id}/restore`, {});
  }

  removePermanently(id: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`/api/notes/${id}/permanent`);
  }

  emptyTrash(): Observable<{ deleted: string[] }> {
    return this.http.post<{ deleted: string[] }>('/api/notes/trash/empty', {});
  }

  duplicate(id: string): Observable<NoteSummaryDto> {
    return this.http.post<NoteSummaryDto>(`/api/notes/${id}/duplicate`, {});
  }

  setTags(id: string, names: string[]): Observable<{ tags: string[] }> {
    return this.http.put<{ tags: string[] }>(`/api/notes/${id}/tags`, {
      names,
    });
  }

  batchDelete(ids: string[]): Observable<{ deleted: string[] }> {
    return this.http.post<{ deleted: string[] }>('/api/notes/batch-delete', {
      ids,
    });
  }

  /** Data management: fetch the selected scopes of notes (with content). */
  exportNotes(scopes: ExportScopes): Observable<NotesExportDto> {
    const params = new HttpParams()
      .set('mine', scopes.mine ? '1' : '0')
      .set('shared', scopes.shared ? '1' : '0')
      .set('public', scopes.public ? '1' : '0');
    return this.http.get<NotesExportDto>('/api/notes/export', { params });
  }

  /** Data management: bulk-create notes parsed from imported Markdown files. */
  importNotes(notes: ImportNoteDto[]): Observable<ImportNotesResultDto> {
    return this.http.post<ImportNotesResultDto>('/api/notes/import', { notes });
  }

  reorder(orderedIds: string[]): Observable<{ updated: string[] }> {
    return this.http.post<{ updated: string[] }>('/api/notes/reorder', {
      orderedIds,
    });
  }

  getShares(id: string): Observable<NoteSharesDto> {
    return this.http.get<NoteSharesDto>(`/api/notes/${id}/shares`);
  }

  setShares(id: string, grants: ShareGrantDto[]): Observable<NoteSharesDto> {
    return this.http.put<NoteSharesDto>(`/api/notes/${id}/shares`, { grants });
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
