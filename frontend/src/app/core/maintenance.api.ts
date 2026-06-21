import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { DatabaseStatsDto, RinseResultDto } from '@perpetuum-nota/shared';

@Injectable({ providedIn: 'root' })
export class MaintenanceApi {
  private readonly http = inject(HttpClient);

  /** Admin: content row counts for the "Rinse database" panel. */
  stats(): Observable<DatabaseStatsDto> {
    return this.http.get<DatabaseStatsDto>('/api/maintenance/stats');
  }

  /** Admin: wipe all content (keeps user accounts). Irreversible. */
  rinse(): Observable<RinseResultDto> {
    return this.http.post<RinseResultDto>('/api/maintenance/rinse', {});
  }
}
