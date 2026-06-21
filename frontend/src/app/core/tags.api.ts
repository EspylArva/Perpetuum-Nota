import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { TagDto } from '@perpetuum-nota/shared';

@Injectable({ providedIn: 'root' })
export class TagsApi {
  private readonly http = inject(HttpClient);

  /** The caller's tags with live-note counts. */
  list(): Observable<TagDto[]> {
    return this.http.get<TagDto[]>('/api/tags');
  }

  remove(id: string): Observable<{ id: string }> {
    return this.http.delete<{ id: string }>(`/api/tags/${id}`);
  }
}
