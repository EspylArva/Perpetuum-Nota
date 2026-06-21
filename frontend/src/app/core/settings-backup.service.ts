import { Injectable, inject } from '@angular/core';
import type { SettingsBackupDto } from '@perpetuum-nota/shared';
import { DATE_FORMATS, DateFormat } from './date-format';
import { SettingsStore } from './settings.store';
import { ThemeName, ThemeStore } from './theme.store';

/**
 * Serializes the user's client-side preferences (theme + display settings, all
 * localStorage-backed) to a portable JSON document and restores them from one.
 * This is the engine behind Settings → Account → "Export / Import settings";
 * it's the only way to carry preferences between browsers or devices, since
 * none of this lives in the database.
 *
 * Restore is intentionally lenient: each field is validated against its allowed
 * set and applied independently, so a backup from a different app version (with
 * extra or missing fields) still imports cleanly, applying whatever it can.
 */
@Injectable({ providedIn: 'root' })
export class SettingsBackupService {
  private readonly theme = inject(ThemeStore);
  private readonly settings = inject(SettingsStore);

  /** Current preferences as a backup document. */
  snapshot(): SettingsBackupDto {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      theme: {
        mode: this.theme.mode(),
        name: this.theme.themeName(),
      },
      preferences: {
        dateFormat: this.settings.dateFormat(),
        weekStart: this.settings.weekStart(),
        dueDisplay: this.settings.dueDisplay(),
        confirmOnDelete: this.settings.confirmOnDelete(),
        numberedHeadings: this.settings.numberedHeadings(),
      },
    };
  }

  /**
   * Applies a parsed backup, validating each field. Returns the list of fields
   * actually applied (so the UI can report what changed). Throws if `data` is
   * not a recognisable backup object.
   */
  restore(data: unknown): { applied: string[] } {
    if (!data || typeof data !== 'object') {
      throw new Error('Not a settings backup file.');
    }
    const root = data as Partial<SettingsBackupDto>;
    const theme = (root.theme ?? {}) as Record<string, unknown>;
    const prefs = (root.preferences ?? {}) as Record<string, unknown>;
    const applied: string[] = [];

    if (theme['mode'] === 'light' || theme['mode'] === 'dark') {
      this.theme.set(theme['mode']);
      applied.push('theme mode');
    }
    if (this.isThemeName(theme['name'])) {
      this.theme.setThemeName(theme['name']);
      applied.push('theme palette');
    }
    if (this.isDateFormat(prefs['dateFormat'])) {
      this.settings.setDateFormat(prefs['dateFormat']);
      applied.push('date format');
    }
    if (prefs['weekStart'] === 'sunday' || prefs['weekStart'] === 'monday') {
      this.settings.setWeekStart(prefs['weekStart']);
      applied.push('week start');
    }
    if (prefs['dueDisplay'] === 'relative' || prefs['dueDisplay'] === 'absolute') {
      this.settings.setDueDisplay(prefs['dueDisplay']);
      applied.push('due-date display');
    }
    if (typeof prefs['confirmOnDelete'] === 'boolean') {
      this.settings.setConfirmOnDelete(prefs['confirmOnDelete']);
      applied.push('delete confirmation');
    }
    if (typeof prefs['numberedHeadings'] === 'boolean') {
      this.settings.setNumberedHeadings(prefs['numberedHeadings']);
      applied.push('heading numbering');
    }

    if (applied.length === 0) {
      throw new Error('No recognisable settings were found in the file.');
    }
    return { applied };
  }

  private isThemeName(v: unknown): v is ThemeName {
    return this.theme.themes.some((t) => t.value === v);
  }

  private isDateFormat(v: unknown): v is DateFormat {
    return DATE_FORMATS.some((f) => f.value === v);
  }
}
