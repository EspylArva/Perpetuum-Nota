import { Injectable, signal } from '@angular/core';

const KEY = 'sticky.sidenav';

/**
 * Collapsed state of the desktop sidebar, persisted to localStorage.
 * Mobile uses an over-mode drawer controlled separately in the Manager.
 */
@Injectable({ providedIn: 'root' })
export class SidenavStore {
  private readonly _collapsed = signal<boolean>(this.read());
  readonly collapsed = this._collapsed.asReadonly();

  toggle(): void {
    this.set(!this._collapsed());
  }

  set(collapsed: boolean): void {
    this._collapsed.set(collapsed);
    try {
      localStorage.setItem(KEY, String(collapsed));
    } catch {
      /* ignore storage errors */
    }
  }

  private read(): boolean {
    try {
      return localStorage.getItem(KEY) === 'true';
    } catch {
      return false;
    }
  }
}
