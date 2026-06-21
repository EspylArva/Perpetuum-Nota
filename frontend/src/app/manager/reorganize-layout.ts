/**
 * "Reorganize" placement for the wall: every card sorted by title, laid out
 * left-to-right with ONE empty cell between cards. Cards have a fixed
 * WALL_CARD_CELLS width and variable height (in cells) — each new row starts
 * below the tallest card of the previous row plus the gap. Pure + DOM-free.
 */
import { WALL_CARD_CELLS } from './wall-cell.directive';

const GAP = 1; // one empty cell between cards

export interface CellPos {
  x: number;
  y: number;
}

export function reorganizeLayout(
  notes: readonly { id: string; title: string }[],
  heights: ReadonlyMap<string, number>,
  cols: number,
): Map<string, CellPos> {
  const step = WALL_CARD_CELLS + GAP;
  const perRow = Math.max(1, Math.floor((cols + GAP) / step));
  const ordered = [...notes].sort((a, b) =>
    (a.title || 'Untitled').localeCompare(b.title || 'Untitled'),
  );
  const out = new Map<string, CellPos>();
  let col = 0;
  let rowY = 0;
  let rowH = 0;
  for (const n of ordered) {
    if (col === perRow) {
      col = 0;
      rowY += rowH + GAP;
      rowH = 0;
    }
    out.set(n.id, { x: col * step, y: rowY });
    rowH = Math.max(rowH, heights.get(n.id) ?? 3);
    col++;
  }
  return out;
}
