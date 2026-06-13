/**
 * Pure clamping for wall (grid) panning. Side-effect-free and DOM-free so it can
 * be unit-tested without a browser.
 *
 * The wall is an absolutely-positioned content layer that may be larger than its
 * viewport. Panning translates that layer by `panOffset` (a translate(x, y) on
 * the `.wall-grid`). Positive offset moves content right/down (revealing space
 * before the origin); negative offset moves content left/up (revealing content
 * past the viewport's right/bottom edge).
 *
 * Clamp rule (per axis, here shown for x; y is analogous with h/height):
 *   Let `over = max(0, content.w - viewport.w)` — how far content extends beyond
 *   one viewport. The user may:
 *     - overscroll up to ONE viewport BEFORE the origin  → max offset = +viewport.w
 *     - pan to reveal all content, then overscroll up to ONE viewport PAST the
 *       farthest content                                 → min offset = -(over + viewport.w)
 *   So x ∈ [-(over + viewport.w), viewport.w].
 *
 * When content is smaller than the viewport (`over === 0`) the range collapses to
 * [-viewport.w, viewport.w] — a small symmetric overscroll, never infinite.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Clamps a single axis to [-(over + viewport), viewport]; see module doc. */
function clampAxis(offset: number, content: number, viewport: number): number {
  const over = Math.max(0, content - viewport);
  const min = -(over + viewport);
  const max = viewport;
  return Math.min(max, Math.max(min, offset));
}

/**
 * Clamps a pan offset so panning is bounded to (content extent + one viewport)
 * of overscroll in each direction, on both axes. See module doc for the exact
 * rule.
 */
export function clampPan(offset: Vec2, content: Size, viewport: Size): Vec2 {
  return {
    x: clampAxis(offset.x, content.w, viewport.w),
    y: clampAxis(offset.y, content.h, viewport.h),
  };
}
