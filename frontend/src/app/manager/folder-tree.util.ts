import type { FolderDto } from '@perpetuum-nota/shared';

/** A folder plus its resolved children and depth, for recursive rendering. */
export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  noteCount: number;
  depth: number;
  children: FolderNode[];
}

/**
 * Builds a nested tree from a flat folder list, keyed by parentId.
 *
 * Robust to bad data:
 *  - Orphans (a parentId pointing at a missing/foreign folder) are promoted to
 *    roots so they never vanish from the UI.
 *  - Cycles (a folder reachable from itself via parent links) are broken: the
 *    first node already on the current ancestry path is treated as a root, so
 *    the walk always terminates.
 *
 * Children at each level are sorted by name (case-insensitive), matching the
 * server's name-ordered flat list.
 */
export function buildFolderTree(flat: FolderDto[]): FolderNode[] {
  const byId = new Map<string, FolderDto>();
  for (const f of flat) byId.set(f.id, f);

  // A folder roots at the top level if it has no parent, its parent is unknown
  // (orphan), or following its parent chain loops back to itself without ever
  // reaching a parentless folder (trapped in a cycle). The cycle case is what
  // keeps such folders visible instead of silently disappearing.
  const rootsAtTop = (f: FolderDto): boolean => {
    if (f.parentId === null || !byId.has(f.parentId)) return true;
    const seen = new Set<string>([f.id]);
    let cur: string | null = f.parentId;
    while (cur) {
      if (seen.has(cur)) return true; // cycle that never escapes to a real root
      seen.add(cur);
      const parent: FolderDto | undefined = byId.get(cur);
      if (!parent) return true; // chain hit an orphan/unknown — also a top root
      cur = parent.parentId;
    }
    return false;
  };

  const childrenOf = new Map<string | null, FolderDto[]>();
  for (const f of flat) {
    const key = rootsAtTop(f) ? null : f.parentId;
    const list = childrenOf.get(key) ?? [];
    list.push(f);
    childrenOf.set(key, list);
  }

  const sortByName = (a: FolderDto, b: FolderDto): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  // Recursive build with cycle protection via a path set so the walk always
  // terminates even on malformed (self/mutually referential) data.
  const build = (
    parentKey: string | null,
    depth: number,
    path: Set<string>,
  ): FolderNode[] => {
    const kids = (childrenOf.get(parentKey) ?? []).slice().sort(sortByName);
    const out: FolderNode[] = [];
    for (const f of kids) {
      if (path.has(f.id)) continue; // cycle guard: skip an ancestor re-entering
      const nextPath = new Set(path);
      nextPath.add(f.id);
      out.push({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        noteCount: f.noteCount,
        depth,
        children: build(f.id, depth + 1, nextPath),
      });
    }
    return out;
  };

  return build(null, 0, new Set<string>());
}
