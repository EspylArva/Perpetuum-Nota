/**
 * Pure helpers for rendering a note's due date. Kept framework-free so they can
 * be unit-tested without a TestBed.
 *
 *  - `dueState` drives styling: "passed" (overdue) → struck-through + muted,
 *    "nearing" (within the next 48h) → amber/warn, "normal" → neutral.
 *  - `dueLabel` gives the human relative wording shown on the chip.
 */

export type DueState = 'passed' | 'nearing' | 'normal';

/** 48-hour nearing window, in milliseconds. */
const NEARING_MS = 48 * 60 * 60 * 1000;

function toDate(due: Date | string): Date {
  return due instanceof Date ? due : new Date(due);
}

/** Local midnight (00:00:00.000) of the given date. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Local end-of-day (23:59:59.999) of the given date. */
export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** True when two dates fall on the same local calendar day. */
export function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/**
 * Classifies a due date relative to `now` (defaults to the current time):
 *  - "passed"  — the due timestamp is strictly in the past.
 *  - "nearing" — due now or within the next 48 hours (inclusive of now,
 *                exclusive of exactly +48h).
 *  - "normal"  — further than 48 hours out.
 */
export function dueState(due: Date | string, now: Date = new Date()): DueState {
  const diff = toDate(due).getTime() - now.getTime();
  if (diff < 0) return 'passed';
  if (diff < NEARING_MS) return 'nearing';
  return 'normal';
}

/**
 * Human wording based on the calendar-day difference (local midnight to local
 * midnight), so "due today" covers any time today even if the exact timestamp
 * has already slipped by:
 *   today / tomorrow / in N days / overdue N days.
 */
export function dueLabel(due: Date | string, now: Date = new Date()): string {
  const dueDay = startOfDay(toDate(due)).getTime();
  const nowDay = startOfDay(now).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const deltaDays = Math.round((dueDay - nowDay) / dayMs);

  if (deltaDays === 0) return 'due today';
  if (deltaDays === 1) return 'due tomorrow';
  if (deltaDays > 1) return `due in ${deltaDays} days`;
  const overdue = -deltaDays;
  return `overdue ${overdue} ${overdue === 1 ? 'day' : 'days'}`;
}
