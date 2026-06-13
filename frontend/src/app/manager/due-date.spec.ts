import { describe, expect, it } from 'vitest';
import { dueLabel, dueState } from './due-date';

// A fixed "now" used as the reference point. Local time is irrelevant to the
// helper's day math because both `due` and `now` are interpreted in the same
// (local) zone; we build dates via the Date constructor so the test is
// deterministic regardless of the machine's timezone.
const NOW = new Date(2026, 5, 15, 10, 0, 0); // 2026-06-15 10:00 local

/** Local date at the given offset of days from NOW, keeping the same clock. */
function days(offset: number, hours = 10): Date {
  return new Date(2026, 5, 15 + offset, hours, 0, 0);
}

describe('dueLabel', () => {
  it('says "due today" for any time on the same calendar day', () => {
    expect(dueLabel(new Date(2026, 5, 15, 23, 59), NOW)).toBe('due today');
    expect(dueLabel(new Date(2026, 5, 15, 0, 1), NOW)).toBe('due today');
  });

  it('says "due tomorrow" for the next calendar day', () => {
    expect(dueLabel(days(1), NOW)).toBe('due tomorrow');
    expect(dueLabel(new Date(2026, 5, 16, 0, 5), NOW)).toBe('due tomorrow');
  });

  it('says "due in N days" for future days beyond tomorrow', () => {
    expect(dueLabel(days(3), NOW)).toBe('due in 3 days');
    expect(dueLabel(days(2), NOW)).toBe('due in 2 days');
    expect(dueLabel(days(10), NOW)).toBe('due in 10 days');
  });

  it('says "overdue N days" for past calendar days', () => {
    expect(dueLabel(days(-1), NOW)).toBe('overdue 1 day');
    expect(dueLabel(days(-2), NOW)).toBe('overdue 2 days');
    expect(dueLabel(days(-5), NOW)).toBe('overdue 5 days');
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(dueLabel(days(1).toISOString(), NOW)).toBe('due tomorrow');
  });
});

describe('dueState', () => {
  it('is "passed" when the due timestamp is strictly before now', () => {
    expect(dueState(new Date(NOW.getTime() - 1), NOW)).toBe('passed');
    expect(dueState(days(-1), NOW)).toBe('passed');
  });

  it('is "nearing" within the next 48 hours (not passed)', () => {
    expect(dueState(new Date(NOW.getTime() + 1000), NOW)).toBe('nearing');
    expect(dueState(days(1), NOW)).toBe('nearing'); // +24h
    // +47h59m — still inside the window
    expect(
      dueState(new Date(NOW.getTime() + (48 * 60 - 1) * 60 * 1000), NOW),
    ).toBe('nearing');
  });

  it('at exactly now (diff = 0) it is nearing, not passed', () => {
    expect(dueState(new Date(NOW.getTime()), NOW)).toBe('nearing');
  });

  it('at exactly +48h the nearing window has closed → normal', () => {
    expect(dueState(new Date(NOW.getTime() + 48 * 60 * 60 * 1000), NOW)).toBe(
      'normal',
    );
  });

  it('is "normal" for dates further out than 48 hours', () => {
    expect(dueState(days(5), NOW)).toBe('normal');
    expect(dueState(days(30), NOW)).toBe('normal');
  });

  it('accepts an ISO string', () => {
    expect(dueState(days(-1).toISOString(), NOW)).toBe('passed');
  });
});
