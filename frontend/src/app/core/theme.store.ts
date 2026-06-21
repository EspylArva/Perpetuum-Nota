import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';
export type ThemeName = 'default' | 'monokai' | 'dracula' | 'nord';

const KEY = 'sticky.theme';
const KEY_NAME = 'sticky.themeName';

/**
 * Theme state, persisted to localStorage. Two orthogonal axes:
 *
 *  - light/dark (`mode`) — toggles the `dark` class on <html>, which flips
 *    `color-scheme` and with it every Material light-dark() token. Defaults to
 *    the OS preference on first visit.
 *  - named palette (`themeName`) — toggles a `theme-<name>` class on <html>
 *    (none for 'default'), which re-includes the M3 theme with a different
 *    Material palette. Independent of light/dark.
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly _mode = signal<ThemeMode>(this.read());
  readonly mode = this._mode.asReadonly();

  private readonly _themeName = signal<ThemeName>(this.readName());
  readonly themeName = this._themeName.asReadonly();

  /** Named palettes for the picker. */
  readonly themes: { value: ThemeName; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'monokai', label: 'Monokai' },
    { value: 'dracula', label: 'Dracula' },
    { value: 'nord', label: 'Nord' },
  ];

  constructor() {
    this.apply(this._mode());
    this.applyName(this._themeName());
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

  setThemeName(name: ThemeName): void {
    this._themeName.set(name);
    this.applyName(name);
    try {
      localStorage.setItem(KEY_NAME, name);
    } catch {
      /* ignore storage errors */
    }
  }

  private apply(mode: ThemeMode): void {
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }

  /**
   * Swaps the `theme-<name>` class on <html>: drops any existing one, then adds
   * the new one (none for 'default'). Leaves the `dark` class untouched.
   */
  private applyName(name: ThemeName): void {
    const el = document.documentElement;
    el.classList.forEach((c) => {
      if (c.startsWith('theme-')) el.classList.remove(c);
    });
    if (name !== 'default') el.classList.add(`theme-${name}`);
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

  private readName(): ThemeName {
    try {
      const stored = localStorage.getItem(KEY_NAME);
      if (
        stored === 'default' ||
        stored === 'monokai' ||
        stored === 'dracula' ||
        stored === 'nord'
      ) {
        return stored;
      }
    } catch {
      /* ignore storage errors */
    }
    return 'default';
  }
}
