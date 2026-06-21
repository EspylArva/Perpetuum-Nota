import { describe, expect, it } from 'vitest';
import { linkLines } from './wall-links';
import { WALL_CARD_CELLS, WALL_CELL } from './wall-cell.directive';

const HALF_W = (WALL_CARD_CELLS * WALL_CELL) / 2;

describe('linkLines', () => {
  it('joins card centers, honoring the row offset and heights', () => {
    const layout = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 6, y: 2 }],
    ]);
    const heights = new Map([
      ['a', 2],
      ['b', 4],
    ]);
    const [line] = linkLines([{ a: 'a', b: 'b' }], layout, heights, 1);
    expect(line).toEqual({
      x1: HALF_W,
      y1: (1 + 0) * WALL_CELL + (2 * WALL_CELL) / 2,
      x2: 6 * WALL_CELL + HALF_W,
      y2: (1 + 2) * WALL_CELL + (4 * WALL_CELL) / 2,
    });
  });

  it('drops edges whose endpoints are not both laid out', () => {
    const layout = new Map([['a', { x: 0, y: 0 }]]);
    expect(linkLines([{ a: 'a', b: 'missing' }], layout, new Map(), 0)).toEqual(
      [],
    );
  });
});
