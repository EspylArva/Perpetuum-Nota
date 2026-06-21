import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { AppInfoDto } from '@perpetuum-nota/shared';

/** Build/version metadata for the Settings "App info" panel (public endpoint). */
@Injectable({ providedIn: 'root' })
export class AppInfoApi {
  private readonly http = inject(HttpClient);

  get(): Observable<AppInfoDto> {
    return this.http.get<AppInfoDto>('/api/info');
  }
}
