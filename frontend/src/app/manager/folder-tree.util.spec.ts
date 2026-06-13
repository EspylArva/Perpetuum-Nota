import { describe, expect, it } from 'vitest';
import { buildFolderTree, type FolderNode } from './folder-tree.util';
import type { FolderDto } from '@stickynotes/shared';

const f = (
  id: string,
  name: string,
  parentId: string | null,
  noteCount = 0,
): FolderDto => ({ id, name, parentId, noteCount });

/** Flattens the tree to "id@depth" tokens for compact assertions. */
function flatten(nodes: FolderNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FolderNode[]) => {
    for (const n of ns) {
      out.push(`${n.id}@${n.depth}`);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

describe('buildFolderTree', () => {
  it('returns an empty array for no folders', () => {
    expect(buildFolderTree([])).toEqual([]);
  });

  it('nests children under their parent with correct depth', () => {
    const tree = buildFolderTree([
      f('a', 'Alpha', null),
      f('b', 'Bravo', 'a'),
      f('c', 'Charlie', 'b'),
    ]);
    expect(flatten(tree)).toEqual(['a@0', 'b@1', 'c@2']);
  });

  it('sorts siblings by name case-insensitively', () => {
    const tree = buildFolderTree([
      f('z', 'zeta', null),
      f('a', 'Alpha', null),
      f('m', 'mike', null),
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'm', 'z']);
  });

  it('carries noteCount through', () => {
    const tree = buildFolderTree([f('a', 'Alpha', null, 7)]);
    expect(tree[0].noteCount).toBe(7);
  });

  it('promotes orphans (unknown parent) to roots so they never vanish', () => {
    const tree = buildFolderTree([
      f('a', 'Alpha', null),
      f('orphan', 'Orphan', 'missing-parent-id'),
    ]);
    // both appear at the root
    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'orphan']);
    expect(tree.every((n) => n.depth === 0)).toBe(true);
  });

  it('is cycle-safe: a self-parented folder does not loop forever', () => {
    const tree = buildFolderTree([f('a', 'Alpha', 'a')]);
    // 'a' references itself → treated as a root, rendered once.
    expect(flatten(tree)).toEqual(['a@0']);
  });

  it('is cycle-safe across a multi-node cycle', () => {
    // a -> b -> a (both have a known parent, forming a cycle)
    const tree = buildFolderTree([f('a', 'Alpha', 'b'), f('b', 'Bravo', 'a')]);
    // Each node is rendered exactly once; the walk terminates.
    const ids = flatten(tree).map((t) => t.split('@')[0]);
    expect(ids.sort()).toEqual(['a', 'b']);
    expect(ids.length).toBe(2);
  });

  it('builds a multi-level tree with several branches', () => {
    const tree = buildFolderTree([
      f('root', 'Root', null),
      f('work', 'Work', 'root'),
      f('home', 'Home', 'root'),
      f('proj', 'Project', 'work'),
    ]);
    const root = tree[0];
    expect(root.id).toBe('root');
    // children sorted: Home before Work
    expect(root.children.map((c) => c.id)).toEqual(['home', 'work']);
    const work = root.children.find((c) => c.id === 'work')!;
    expect(work.children.map((c) => c.id)).toEqual(['proj']);
    expect(work.children[0].depth).toBe(2);
  });
});
