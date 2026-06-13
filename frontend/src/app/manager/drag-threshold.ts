/**
 * Click-vs-drag discrimination for wall cards. CDK's own drag only fires after
 * its built-in start threshold; a *micro-drag* under that threshold would still
 * register as a plain click and (wrongly) open the note. This pure helper lets
 * the card suppress the open on ANY pointer movement beyond a small tolerance,
 * covering that sub-threshold case.
 *
 * Pure and DOM-free so it can be unit-tested without a browser.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * True when the pointer travelled more than `threshold` px (Euclidean distance)
 * between `start` and `end`. Used to decide a pointerdown→pointerup pair was a
 * drag, not a click. Default tolerance ~3px absorbs hand-jitter on a real click.
 */
export function movedBeyond(start: Point, end: Point, threshold = 3): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.hypot(dx, dy) > threshold;
}
