import { Injectable, signal } from '@angular/core';

export type ViewMode = 'list' | 'wall';
const KEY = 'sticky.viewMode';

/** Holds the manager's view mode, persisted to localStorage. Default: list. */
@Injectable({ providedIn: 'root' })
export class ViewModeStore {
  private readonly _mode = signal<ViewMode>(this.read());
  readonly mode = this._mode.asReadonly();

  set(mode: ViewMode): void {
    this._mode.set(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore storage errors */
    }
  }

  private read(): ViewMode {
    try {
      return localStorage.getItem(KEY) === 'wall' ? 'wall' : 'list';
    } catch {
      return 'list';
    }
  }
}
