import { describe, expect, it } from 'vitest';
import {
  activateTab,
  closeTab,
  openInActiveTab,
  openTab,
  parseStoredTabs,
  patchTab,
  reorderTabs,
  restoreTabs,
  serializeTabs,
  type TabsState,
} from './tab-reducer';

interface Note {
  id: string;
  title: string;
}
const a: Note = { id: 'a', title: 'A' };
const b: Note = { id: 'b', title: 'B' };
const c: Note = { id: 'c', title: 'C' };

const empty: TabsState<Note> = { tabs: [], activeId: null };
const abc: TabsState<Note> = { tabs: [a, b, c], activeId: 'b' };

const ids = (s: TabsState<Note>) => s.tabs.map((t) => t.id);

describe('openTab', () => {
  it('adds to an empty state and focuses it (foreground)', () => {
    const s = openTab(empty, a, { background: false });
    expect(ids(s)).toEqual(['a']);
    expect(s.activeId).toBe('a');
  });

  it('adds a background tab without stealing focus', () => {
    const s = openTab({ tabs: [a], activeId: 'a' }, b, { background: true });
    expect(ids(s)).toEqual(['a', 'b']);
    expect(s.activeId).toBe('a');
  });

  it('does not duplicate an already-open note; foreground reopen activates it', () => {
    const s = openTab(abc, a, { background: false });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    expect(s.activeId).toBe('a');
  });

  it('background reopen of an open note keeps the current focus', () => {
    const s = openTab(abc, a, { background: true });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    expect(s.activeId).toBe('b');
  });

  it('does not mutate the input state', () => {
    openTab(abc, { id: 'd', title: 'D' }, { background: false });
    expect(ids(abc)).toEqual(['a', 'b', 'c']);
  });
});

describe('openInActiveTab', () => {
  it('replaces the focused tab with the note, in place, and focuses it', () => {
    const s = openInActiveTab(abc, { id: 'd', title: 'D' });
    expect(ids(s)).toEqual(['a', 'd', 'c']); // 'b' (active) replaced by 'd'
    expect(s.activeId).toBe('d');
  });

  it('just focuses the note when it is already open (no duplicate, no replace)', () => {
    const s = openInActiveTab(abc, a);
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    expect(s.activeId).toBe('a');
  });

  it('opens a new focused tab when nothing is focused (empty state)', () => {
    const s = openInActiveTab(empty, a);
    expect(ids(s)).toEqual(['a']);
    expect(s.activeId).toBe('a');
  });

  it('opens a new focused tab when tabs exist but none is active', () => {
    const s = openInActiveTab({ tabs: [a, b], activeId: null }, c);
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    expect(s.activeId).toBe('c');
  });

  it('does not mutate the input state', () => {
    openInActiveTab(abc, { id: 'd', title: 'D' });
    expect(ids(abc)).toEqual(['a', 'b', 'c']);
    expect(abc.activeId).toBe('b');
  });
});

describe('closeTab', () => {
  it('closing the active tab focuses the right neighbor', () => {
    const s = closeTab(abc, 'b');
    expect(ids(s)).toEqual(['a', 'c']);
    expect(s.activeId).toBe('c');
  });

  it('closing the active last tab focuses the previous one', () => {
    const s = closeTab({ tabs: [a, b, c], activeId: 'c' }, 'c');
    expect(ids(s)).toEqual(['a', 'b']);
    expect(s.activeId).toBe('b');
  });

  it('closing the only tab clears the active id', () => {
    const s = closeTab({ tabs: [a], activeId: 'a' }, 'a');
    expect(ids(s)).toEqual([]);
    expect(s.activeId).toBeNull();
  });

  it('closing a non-active tab leaves the active id untouched', () => {
    const s = closeTab(abc, 'a');
    expect(ids(s)).toEqual(['b', 'c']);
    expect(s.activeId).toBe('b');
  });

  it('closing an unknown id is a no-op', () => {
    const s = closeTab(abc, 'zzz');
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    expect(s.activeId).toBe('b');
  });
});

describe('activateTab', () => {
  it('sets the active id when the tab is open', () => {
    expect(activateTab(abc, 'c').activeId).toBe('c');
  });
  it('ignores an unknown id', () => {
    expect(activateTab(abc, 'zzz').activeId).toBe('b');
  });
});

describe('reorderTabs', () => {
  it('moves a tab from one index to another, preserving the active id', () => {
    const s = reorderTabs(abc, 0, 2); // A,B,C -> B,C,A
    expect(ids(s)).toEqual(['b', 'c', 'a']);
    expect(s.activeId).toBe('b');
  });
  it('is a no-op when indices are equal', () => {
    expect(ids(reorderTabs(abc, 1, 1))).toEqual(['a', 'b', 'c']);
  });
});

describe('patchTab', () => {
  it('updates only the matching tab', () => {
    const s = patchTab(abc, 'b', { title: 'B2' });
    expect(s.tabs.map((t) => t.title)).toEqual(['A', 'B2', 'C']);
  });
  it('is a no-op for an unknown id', () => {
    expect(patchTab(abc, 'zzz', { title: 'X' }).tabs).toEqual(abc.tabs);
  });
});

describe('serialize / parse', () => {
  it('serializes ids and the active id', () => {
    expect(serializeTabs(abc)).toEqual({ ids: ['a', 'b', 'c'], activeId: 'b' });
  });
  it('parses a valid stored payload', () => {
    expect(parseStoredTabs('{"ids":["a","b"],"activeId":"a"}')).toEqual({
      ids: ['a', 'b'],
      activeId: 'a',
    });
  });
  it('returns null for null / malformed / wrong-shape input', () => {
    expect(parseStoredTabs(null)).toBeNull();
    expect(parseStoredTabs('not json')).toBeNull();
    expect(parseStoredTabs('{"ids":"nope"}')).toBeNull();
    expect(parseStoredTabs('[]')).toBeNull();
  });
});

describe('restoreTabs', () => {
  it('rebuilds tabs in stored order from the fetched (accessible) notes', () => {
    const s = restoreTabs({ ids: ['c', 'a', 'b'], activeId: 'a' }, [a, b, c]);
    expect(ids(s)).toEqual(['c', 'a', 'b']);
    expect(s.activeId).toBe('a');
  });

  it('prunes ids that did not come back (deleted / inaccessible)', () => {
    const s = restoreTabs({ ids: ['a', 'gone', 'c'], activeId: 'c' }, [a, c]);
    expect(ids(s)).toEqual(['a', 'c']);
    expect(s.activeId).toBe('c');
  });

  it('falls back the active id to the first surviving tab when the stored active was pruned', () => {
    const s = restoreTabs({ ids: ['gone', 'b'], activeId: 'gone' }, [b]);
    expect(ids(s)).toEqual(['b']);
    expect(s.activeId).toBe('b');
  });

  it('yields an empty state when nothing survives', () => {
    const s = restoreTabs({ ids: ['gone'], activeId: 'gone' }, []);
    expect(ids(s)).toEqual([]);
    expect(s.activeId).toBeNull();
  });
});
