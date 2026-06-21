/**
 * Stable partition that floats pinned notes above non-pinned ones while keeping
 * each group's existing relative order. Used after a list drag so a pinned note
 * dropped into the non-pinned region snaps back above all of them on release
 * (pinned always sorts first). Pure + order-preserving so it's drag-safe.
 */
export function pinnedFirst<T extends { pinned?: boolean }>(
  notes: readonly T[],
): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const n of notes) {
    if (n.pinned) pinned.push(n);
    else rest.push(n);
  }
  return [...pinned, ...rest];
}
