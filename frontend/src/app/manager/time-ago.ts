/**
 * Pure "time ago" helper for relative timestamps (e.g. "edited 5 min ago").
 * Framework-free so it can be unit-tested without a TestBed.
 *
 * Buckets (relative to `now`, default = current time):
 *   < 1 min            → "just now"
 *   < 1 hour           → "N min ago"
 *   < 1 day            → "N h ago"
 *   < 7 days           → "N d ago"
 *   ≥ 7 days / future  → absolute date, e.g. "on 12 Jun 2026"
 *
 * Future timestamps clamp to "just now" so a clock skew never shows a negative.
 */

import { toDate } from '../core/date-format';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function timeAgo(value: Date | string, now: Date = new Date()): string {
  const then = toDate(value);
  if (Number.isNaN(then.getTime())) return '';
  const diff = now.getTime() - then.getTime();

  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} d ago`;

  // Beyond a week: absolute date like "on 12 Jun 2026".
  const d = then.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `on ${d}`;
}
