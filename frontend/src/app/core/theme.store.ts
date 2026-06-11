import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';
const KEY = 'sticky.theme';

/**
 * Light/dark theme, persisted to localStorage. Defaults to the OS preference
 * on first visit. Applies by toggling the `dark` class on <html>, which flips
 * `color-scheme` and with it every Material light-dark() token.
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly _mode = signal<ThemeMode>(this.read());
  readonly mode = this._mode.asReadonly();

  constructor() {
    this.apply(this._mode());
  }

  toggle(): void {
    this.set(this._mode() === 'dark' ? 'light' : 'dark');
  }

  set(mode: ThemeMode): void {
    this._mode.set(mode);
    this.apply(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore storage errors */
    }
  }

  private apply(mode: ThemeMode): void {
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }

  private read(): ThemeMode {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === 'dark' || stored === 'light') return stored;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  }
}
