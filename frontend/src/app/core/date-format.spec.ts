import { describe, expect, it } from 'vitest';
import { DATE_FORMATS, formatDate } from './date-format';

// A fixed local date: 14 June 2026. Constructed with the multi-arg `Date`
// ctor so it is interpreted in LOCAL time (no UTC parsing surprise).
const SAMPLE = new Date(2026, 5, 14);

describe('formatDate', () => {
  it('formats medium as a short month name', () => {
    expect(formatDate(SAMPLE, 'medium')).toBe('Jun 14, 2026');
  });

  it('formats iso as YYYY-MM-DD', () => {
    expect(formatDate(SAMPLE, 'iso')).toBe('2026-06-14');
  });

  it('formats us as MM/DD/YYYY (zero-padded)', () => {
    expect(formatDate(SAMPLE, 'us')).toBe('06/14/2026');
  });

  it('formats eu as DD/MM/YYYY (zero-padded)', () => {
    expect(formatDate(SAMPLE, 'eu')).toBe('14/06/2026');
  });

  it('zero-pads single-digit months and days', () => {
    const early = new Date(2026, 0, 5); // 5 Jan 2026
    expect(formatDate(early, 'iso')).toBe('2026-01-05');
    expect(formatDate(early, 'us')).toBe('01/05/2026');
    expect(formatDate(early, 'eu')).toBe('05/01/2026');
  });

  it('accepts an ISO string input', () => {
    expect(formatDate('2026-06-14', 'iso')).toBe('2026-06-14');
    expect(formatDate('2026-06-14', 'eu')).toBe('14/06/2026');
  });

  it('DATE_FORMATS examples match formatDate on the sample date', () => {
    for (const f of DATE_FORMATS) {
      expect(formatDate(SAMPLE, f.value)).toBe(f.example);
    }
  });
});
