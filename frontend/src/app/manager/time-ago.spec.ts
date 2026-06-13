import { describe, expect, it } from 'vitest';
import { timeAgo } from './time-ago';

// Fixed reference "now" so the buckets are deterministic regardless of the
// machine clock. 2026-06-13 12:00:00 local.
const NOW = new Date(2026, 5, 13, 12, 0, 0);

/** A Date `ms` milliseconds before NOW. */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('timeAgo', () => {
  it('"just now" within the last minute', () => {
    expect(timeAgo(NOW, NOW)).toBe('just now');
    expect(timeAgo(ago(0), NOW)).toBe('just now');
    expect(timeAgo(ago(59 * SEC), NOW)).toBe('just now');
  });

  it('"N min ago" from 1 up to 59 minutes', () => {
    expect(timeAgo(ago(MIN), NOW)).toBe('1 min ago');
    expect(timeAgo(ago(5 * MIN), NOW)).toBe('5 min ago');
    expect(timeAgo(ago(59 * MIN), NOW)).toBe('59 min ago');
  });

  it('"N h ago" from 1 up to 23 hours', () => {
    expect(timeAgo(ago(HOUR), NOW)).toBe('1 h ago');
    expect(timeAgo(ago(3 * HOUR), NOW)).toBe('3 h ago');
    expect(timeAgo(ago(23 * HOUR), NOW)).toBe('23 h ago');
  });

  it('"N d ago" from 1 up to 6 days', () => {
    expect(timeAgo(ago(DAY), NOW)).toBe('1 d ago');
    expect(timeAgo(ago(2 * DAY), NOW)).toBe('2 d ago');
    expect(timeAgo(ago(6 * DAY), NOW)).toBe('6 d ago');
  });

  it('beyond 7 days falls back to an absolute date', () => {
    // 8 days before NOW = 2026-06-05.
    expect(timeAgo(ago(8 * DAY), NOW)).toBe('on 5 Jun 2026');
    // 7 days exactly is already the absolute form.
    expect(timeAgo(ago(7 * DAY), NOW)).toBe('on 6 Jun 2026');
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(timeAgo(ago(5 * MIN).toISOString(), NOW)).toBe('5 min ago');
  });

  it('a future timestamp clamps to "just now" (never negative)', () => {
    expect(timeAgo(new Date(NOW.getTime() + 5 * MIN), NOW)).toBe('just now');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(timeAgo('not-a-date', NOW)).toBe('');
  });
});
