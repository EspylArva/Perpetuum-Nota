import { describe, expect, it } from 'vitest';
import { reorganizeLayout } from './reorganize-layout';
import { WALL_CARD_CELLS } from './wall-cell.directive';

const STEP = WALL_CARD_CELLS + 1; // card width + 1-cell gap

describe('reorganizeLayout', () => {
  it('sorts by title and wraps rows with a one-cell gap', () => {
    // cols 13 → two cards per row (6 + gap + 6 = 13).
    const heights = new Map([
      ['a', 2],
      ['b', 3],
      ['c', 2],
    ]);
    const layout = reorganizeLayout(
      [
        { id: 'c', title: 'Charlie' },
        { id: 'a', title: 'Alpha' },
        { id: 'b', title: 'Bravo' },
      ],
      heights,
      13,
    );
    expect(layout.get('a')).toEqual({ x: 0, y: 0 });
    expect(layout.get('b')).toEqual({ x: STEP, y: 0 });
    // Third card wraps below the tallest card of row 0 (height 3) + 1 gap.
    expect(layout.get('c')).toEqual({ x: 0, y: 4 });
  });

  it('treats an empty title as "Untitled" without throwing', () => {
    const layout = reorganizeLayout(
      [{ id: 'x', title: '' }],
      new Map(),
      6,
    );
    expect(layout.get('x')).toEqual({ x: 0, y: 0 });
  });
});
