/**
 * Pure date formatting used app-wide. The user picks one {@link DateFormat} in
 * Settings; everything that renders a date funnels through {@link formatDate}
 * (usually via `SettingsStore.format`) so the choice is honoured everywhere.
 *
 * All formatting is LOCAL (no UTC shift): an ISO-string input is parsed by the
 * platform `Date`, and the `iso`/`us`/`eu` formats read the local Y/M/D so the
 * displayed day matches the user's wall clock.
 */

export type DateFormat = 'medium' | 'iso' | 'us' | 'eu';

/** Picker metadata: the value, a human label, and a worked example. */
export const DATE_FORMATS: { value: DateFormat; label: string; example: string }[] = [
  { value: 'medium', label: 'Medium', example: 'Jun 14, 2026' },
  { value: 'iso', label: 'ISO 8601', example: '2026-06-14' },
  { value: 'us', label: 'US', example: '06/14/2026' },
  { value: 'eu', label: 'European', example: '14/06/2026' },
];

/** Zero-pads a number to two digits (e.g. 6 → "06"). */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Coerces a `Date` or ISO string to a `Date` (ISO strings via the platform parser). */
export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Formats `date` (a `Date` or ISO string) per `fmt`. Pure — no locale state or
 * side effects beyond reading the input's local calendar fields.
 */
export function formatDate(date: Date | string, fmt: DateFormat): string {
  const d = toDate(date);

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());

  switch (fmt) {
    case 'iso':
      return `${year}-${month}-${day}`;
    case 'us':
      return `${month}/${day}/${year}`;
    case 'eu':
      return `${day}/${month}/${year}`;
    case 'medium':
    default:
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
  }
}
