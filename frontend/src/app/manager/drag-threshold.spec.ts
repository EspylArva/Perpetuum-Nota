import { describe, expect, it } from 'vitest';
import { movedBeyond } from './drag-threshold';

describe('movedBeyond', () => {
  it('no movement is not a drag', () => {
    expect(movedBeyond({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });

  it('sub-threshold jitter is not a drag (treated as a click)', () => {
    expect(movedBeyond({ x: 0, y: 0 }, { x: 2, y: 0 })).toBe(false);
    expect(movedBeyond({ x: 0, y: 0 }, { x: 2, y: 1 })).toBe(false); // ~2.24px
  });

  it('exactly at the threshold is NOT beyond (strict >)', () => {
    expect(movedBeyond({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
  });

  it('movement beyond the threshold is a drag', () => {
    expect(movedBeyond({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(movedBeyond({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(true);
    expect(movedBeyond({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true); // ~4.24px
  });

  it('measures Euclidean distance, direction-agnostic', () => {
    expect(movedBeyond({ x: 100, y: 100 }, { x: 90, y: 100 })).toBe(true);
    expect(movedBeyond({ x: 100, y: 100 }, { x: 100, y: 90 })).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(movedBeyond({ x: 0, y: 0 }, { x: 8, y: 0 }, 10)).toBe(false);
    expect(movedBeyond({ x: 0, y: 0 }, { x: 12, y: 0 }, 10)).toBe(true);
  });
});
