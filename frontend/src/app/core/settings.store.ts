import { Injectable, signal } from '@angular/core';
import { DateFormat, formatDate } from './date-format';

export type WeekStart = 'sunday' | 'monday';

/**
 * How a note's due date is worded on cards/rows:
 *  - 'relative' — "due tomorrow" / "overdue 2 days" (the default).
 *  - 'absolute' — always the formatted calendar date (honours `dateFormat`).
 */
export type DueDisplay = 'relative' | 'absolute';

const KEY_DATE_FORMAT = 'sticky.settings.dateFormat';
const KEY_WEEK_START = 'sticky.settings.weekStart';
const KEY_DUE_DISPLAY = 'sticky.settings.dueDisplay';
const KEY_CONFIRM_ON_DELETE = 'sticky.settings.confirmOnDelete';
const KEY_NUMBERED_HEADINGS = 'sticky.settings.numberedHeadings';

/**
 * User-facing display preferences (date format + week-start), persisted to
 * localStorage as signals. The date format drives every rendered date via
 * {@link format}; the week-start feeds the Material datepicker through
 * `SettingsDateAdapter`. All storage access is guarded (match ThemeStore).
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly _dateFormat = signal<DateFormat>(this.readDateFormat());
  readonly dateFormat = this._dateFormat.asReadonly();

  private readonly _weekStart = signal<WeekStart>(this.readWeekStart());
  readonly weekStart = this._weekStart.asReadonly();

  private readonly _dueDisplay = signal<DueDisplay>(this.readDueDisplay());
  readonly dueDisplay = this._dueDisplay.asReadonly();

  // Whether to confirm before deleting a note or folder. Defaults ON (opt-out).
  private readonly _confirmOnDelete = signal<boolean>(this.readConfirmOnDelete());
  readonly confirmOnDelete = this._confirmOnDelete.asReadonly();

  // Whether headings show automatic outline numbers (1, 1.1, …). Defaults OFF.
  private readonly _numberedHeadings = signal<boolean>(this.readNumberedHeadings());
  readonly numberedHeadings = this._numberedHeadings.asReadonly();

  setNumberedHeadings(on: boolean): void {
    this._numberedHeadings.set(on);
    try {
      localStorage.setItem(KEY_NUMBERED_HEADINGS, on ? 'true' : 'false');
    } catch {
      /* ignore storage errors */
    }
  }

  setConfirmOnDelete(on: boolean): void {
    this._confirmOnDelete.set(on);
    try {
      localStorage.setItem(KEY_CONFIRM_ON_DELETE, on ? 'true' : 'false');
    } catch {
      /* ignore storage errors */
    }
  }

  setDueDisplay(d: DueDisplay): void {
    this._dueDisplay.set(d);
    try {
      localStorage.setItem(KEY_DUE_DISPLAY, d);
    } catch {
      /* ignore storage errors */
    }
  }

  setDateFormat(f: DateFormat): void {
    this._dateFormat.set(f);
    try {
      localStorage.setItem(KEY_DATE_FORMAT, f);
    } catch {
      /* ignore storage errors */
    }
  }

  setWeekStart(w: WeekStart): void {
    this._weekStart.set(w);
    try {
      localStorage.setItem(KEY_WEEK_START, w);
    } catch {
      /* ignore storage errors */
    }
  }

  /** Formats a date with the current `dateFormat`. */
  format(date: Date | string): string {
    return formatDate(date, this._dateFormat());
  }

  private readDateFormat(): DateFormat {
    try {
      const stored = localStorage.getItem(KEY_DATE_FORMAT);
      if (
        stored === 'medium' ||
        stored === 'iso' ||
        stored === 'us' ||
        stored === 'eu'
      ) {
        return stored;
      }
    } catch {
      /* ignore storage errors */
    }
    return 'medium';
  }

  private readWeekStart(): WeekStart {
    try {
      const stored = localStorage.getItem(KEY_WEEK_START);
      if (stored === 'sunday' || stored === 'monday') return stored;
    } catch {
      /* ignore storage errors */
    }
    return 'sunday';
  }

  private readDueDisplay(): DueDisplay {
    try {
      const stored = localStorage.getItem(KEY_DUE_DISPLAY);
      if (stored === 'relative' || stored === 'absolute') return stored;
    } catch {
      /* ignore storage errors */
    }
    return 'relative';
  }

  private readConfirmOnDelete(): boolean {
    try {
      // Default ON: only an explicit 'false' disables it.
      return localStorage.getItem(KEY_CONFIRM_ON_DELETE) !== 'false';
    } catch {
      return true;
    }
  }

  private readNumberedHeadings(): boolean {
    try {
      // Default OFF: only an explicit 'true' enables it.
      return localStorage.getItem(KEY_NUMBERED_HEADINGS) === 'true';
    } catch {
      return false;
    }
  }
}
