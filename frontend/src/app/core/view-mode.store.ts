import { Injectable, signal } from '@angular/core';
import type { NoteSort } from '@stickynotes/shared';

export type ViewMode = 'list' | 'wall';
const MODE_KEY = 'sticky.viewMode';
const SORT_KEY = 'sticky.sort';

/** Manager display preferences (view mode + sort), persisted to localStorage. */
@Injectable({ providedIn: 'root' })
export class ViewModeStore {
  private readonly _mode = signal<ViewMode>(this.readMode());
  readonly mode = this._mode.asReadonly();

  private readonly _sort = signal<NoteSort>(this.readSort());
  readonly sort = this._sort.asReadonly();

  set(mode: ViewMode): void {
    this._mode.set(mode);
    this.write(MODE_KEY, mode);
  }

  setSort(sort: NoteSort): void {
    this._sort.set(sort);
    this.write(SORT_KEY, sort);
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore storage errors */
    }
  }

  private readMode(): ViewMode {
    try {
      return localStorage.getItem(MODE_KEY) === 'wall' ? 'wall' : 'list';
    } catch {
      return 'list';
    }
  }

  private readSort(): NoteSort {
    try {
      const v = localStorage.getItem(SORT_KEY);
      return v === 'updated' || v === 'created' || v === 'title'
        ? v
        : 'position';
    } catch {
      return 'position';
    }
  }
}
