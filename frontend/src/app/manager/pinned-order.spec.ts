import { describe, expect, it } from 'vitest';
import { pinnedFirst } from './pinned-order';

interface Note {
  id: string;
  pinned?: boolean;
}
const ids = (notes: readonly Note[]) => notes.map((n) => n.id);

describe('pinnedFirst', () => {
  it('floats pinned notes above non-pinned ones', () => {
    const input: Note[] = [
      { id: 'a', pinned: false },
      { id: 'b', pinned: true },
      { id: 'c', pinned: false },
      { id: 'd', pinned: true },
    ];
    expect(ids(pinnedFirst(input))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('preserves the relative order within each group (stable partition)', () => {
    const input: Note[] = [
      { id: 'p1', pinned: true },
      { id: 'u1', pinned: false },
      { id: 'p2', pinned: true },
      { id: 'u2', pinned: false },
      { id: 'p3', pinned: true },
    ];
    // pinned keep p1,p2,p3 order; non-pinned keep u1,u2 order.
    expect(ids(pinnedFirst(input))).toEqual(['p1', 'p2', 'p3', 'u1', 'u2']);
  });

  it('is a no-op (order-preserving) when every note is pinned', () => {
    const input: Note[] = [
      { id: 'a', pinned: true },
      { id: 'b', pinned: true },
      { id: 'c', pinned: true },
    ];
    expect(ids(pinnedFirst(input))).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op (order-preserving) when no note is pinned', () => {
    const input: Note[] = [
      { id: 'a', pinned: false },
      { id: 'b', pinned: false },
      { id: 'c' }, // undefined pinned is treated as non-pinned
    ];
    expect(ids(pinnedFirst(input))).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for empty input', () => {
    expect(pinnedFirst([])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input: Note[] = [
      { id: 'a', pinned: false },
      { id: 'b', pinned: true },
    ];
    const snapshot = ids(input);
    pinnedFirst(input);
    expect(ids(input)).toEqual(snapshot);
  });
});
