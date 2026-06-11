import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ImageUploadResultDto } from '@stickynotes/shared';

@Injectable({ providedIn: 'root' })
export class UploadsApi {
  private readonly http = inject(HttpClient);

  upload(noteId: string, file: File): Observable<ImageUploadResultDto> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImageUploadResultDto>(
      `/api/notes/${noteId}/images`,
      form,
    );
  }
}
