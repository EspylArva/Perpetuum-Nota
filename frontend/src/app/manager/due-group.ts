/**
 * Groups notes into a progressive due-date scale for the list view's separator
 * labels: Past due → Today → Tomorrow → each remaining day this week (dated) →
 * In one week → In one month → Later → No due date.
 *
 * Pure + framework-free (generic over anything carrying a `dueDate`) so it unit
 * tests without a TestBed. Notes keep their incoming order within a group, so a
 * dueDate-sorted input stays sorted inside each bucket.
 */
import { startOfDay } from './due-date';

const DAY = 24 * 60 * 60 * 1000;

export interface DueGroup<T> {
  /** Stable group key (one per bucket; per-day buckets key off the day). */
  key: string;
  /** Centered separator label. */
  label: string;
  notes: T[];
}

/** Whole-calendar-day difference (local midnight to local midnight). */
function dayDiff(due: Date, now: Date): number {
  return Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY);
}

/** Maps a note's dueDate to its bucket (key, label, sort order). */
function bucket(
  due: string | null,
  now: Date,
): { key: string; label: string; order: number } {
  if (!due) return { key: 'none', label: 'No due date', order: 100 };
  const d = new Date(due);
  const diff = dayDiff(d, now);
  if (diff < 0) return { key: 'past', label: 'Past due', order: 0 };
  if (diff === 0) return { key: 'today', label: 'Today', order: 1 };
  if (diff === 1) return { key: 'tomorrow', label: 'Tomorrow', order: 2 };
  if (diff <= 6) {
    // A dated separator per remaining day this week, e.g. "Friday 26 June".
    // ponytail: locale weekday/day/month; no "26th" ordinal suffix.
    const label = d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return { key: `day-${startOfDay(d).getTime()}`, label, order: 3 + diff };
  }
  if (diff <= 13) return { key: 'week', label: 'In one week', order: 20 };
  if (diff <= 30) return { key: 'month', label: 'In one month', order: 21 };
  return { key: 'later', label: 'Later', order: 22 };
}

export function dueGroups<T extends { dueDate: string | null }>(
  notes: readonly T[],
  now: Date = new Date(),
): DueGroup<T>[] {
  const groups = new Map<string, DueGroup<T> & { order: number }>();
  for (const n of notes) {
    const b = bucket(n.dueDate, now);
    let g = groups.get(b.key);
    if (!g) {
      g = { key: b.key, label: b.label, order: b.order, notes: [] };
      groups.set(b.key, g);
    }
    g.notes.push(n);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ key, label, notes }) => ({ key, label, notes }));
}
