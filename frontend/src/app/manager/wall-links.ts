/**
 * Geometry for the wall's "show note links" overlay: line segments joining the
 * centers of linked cards. Edges whose endpoints aren't both currently laid out
 * are dropped. Pure + DOM-free so it unit tests without a browser.
 */
import { WALL_CARD_CELLS, WALL_CELL } from './wall-cell.directive';

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Center pixel of a card from its grid pos, height (cells) and row offset. */
function center(
  pos: { x: number; y: number },
  hCells: number,
  offset: number,
): { x: number; y: number } {
  return {
    x: pos.x * WALL_CELL + (WALL_CARD_CELLS * WALL_CELL) / 2,
    y: (offset + pos.y) * WALL_CELL + (hCells * WALL_CELL) / 2,
  };
}

export function linkLines(
  edges: readonly { a: string; b: string }[],
  layout: ReadonlyMap<string, { x: number; y: number }>,
  heights: ReadonlyMap<string, number>,
  offset: number,
): Line[] {
  const out: Line[] = [];
  for (const e of edges) {
    const a = layout.get(e.a);
    const b = layout.get(e.b);
    if (!a || !b) continue;
    const ca = center(a, heights.get(e.a) ?? 3, offset);
    const cb = center(b, heights.get(e.b) ?? 3, offset);
    out.push({ x1: ca.x, y1: ca.y, x2: cb.x, y2: cb.y });
  }
  return out;
}
