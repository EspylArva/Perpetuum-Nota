/**
 * Pure, framework-agnostic logic for the in-app note tab strip (List mode).
 *
 * State is an ordered list of open tabs plus the focused (active) tab id. Every
 * function returns a NEW state and never mutates its input, so the component can
 * drop the result straight into a signal. Tabs are generic over anything with an
 * `id`, so this tests without Angular / the full NoteSummaryDto.
 */

export interface HasId {
  readonly id: string;
}

export interface TabsState<T extends HasId> {
  readonly tabs: readonly T[];
  readonly activeId: string | null;
}

export interface StoredTabs {
  readonly ids: string[];
  readonly activeId: string | null;
}

/** Adds `note` as a tab (deduped by id). Foreground opens focus it. */
export function openTab<T extends HasId>(
  state: TabsState<T>,
  note: T,
  opts: { background: boolean },
): TabsState<T> {
  const isOpen = state.tabs.some((t) => t.id === note.id);
  const tabs = isOpen ? state.tabs : [...state.tabs, note];
  const activeId = opts.background ? state.activeId : note.id;
  return { tabs, activeId };
}

/**
 * Opens `note` in the currently focused tab (plain-click navigation): if it's
 * already open, just focus it; otherwise replace the active tab's note in place
 * and focus it. With no active tab, opens a new focused tab instead. This keeps
 * the strip from growing on every browse click — only explicit new-tab opens add.
 */
export function openInActiveTab<T extends HasId>(
  state: TabsState<T>,
  note: T,
): TabsState<T> {
  if (state.tabs.some((t) => t.id === note.id)) {
    return { tabs: state.tabs, activeId: note.id };
  }
  const idx = state.activeId
    ? state.tabs.findIndex((t) => t.id === state.activeId)
    : -1;
  if (idx === -1) {
    return { tabs: [...state.tabs, note], activeId: note.id };
  }
  const tabs = state.tabs.map((t, i) => (i === idx ? note : t));
  return { tabs, activeId: note.id };
}

/**
 * Removes the tab with `id`. If it was active, focus shifts to the tab that
 * takes its slot (the right neighbor), or the new last tab, or null if none
 * remain. Closing a non-active or unknown tab leaves the active id untouched.
 */
export function closeTab<T extends HasId>(
  state: TabsState<T>,
  id: string,
): TabsState<T> {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeId !== id) return { tabs, activeId: state.activeId };
  const next = tabs[idx] ?? tabs[idx - 1] ?? null;
  return { tabs, activeId: next ? next.id : null };
}

/** Focuses an open tab; ignores ids that aren't open. */
export function activateTab<T extends HasId>(
  state: TabsState<T>,
  id: string,
): TabsState<T> {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { tabs: state.tabs, activeId: id };
}

/** Moves a tab between positions (drag-reorder), keeping the active id. */
export function reorderTabs<T extends HasId>(
  state: TabsState<T>,
  from: number,
  to: number,
): TabsState<T> {
  if (from === to) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  if (moved === undefined) return state;
  tabs.splice(to, 0, moved);
  return { tabs, activeId: state.activeId };
}

/** Replaces fields on the matching open tab (keeps its summary live). */
export function patchTab<T extends HasId>(
  state: TabsState<T>,
  id: string,
  partial: Partial<T>,
): TabsState<T> {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return {
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    activeId: state.activeId,
  };
}

/** The persisted shape: ids (order) + the active id. No note content. */
export function serializeTabs<T extends HasId>(state: TabsState<T>): StoredTabs {
  return { ids: state.tabs.map((t) => t.id), activeId: state.activeId };
}

/** Safely parses a localStorage payload; null on missing / malformed / wrong shape. */
export function parseStoredTabs(raw: string | null): StoredTabs | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (
      v &&
      typeof v === 'object' &&
      Array.isArray(v.ids) &&
      v.ids.every((id: unknown) => typeof id === 'string') &&
      (v.activeId === null || typeof v.activeId === 'string')
    ) {
      return { ids: v.ids, activeId: v.activeId };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Rebuilds tab state on reload: takes the stored id order and the notes that
 * actually came back from the server (accessible ones), keeps the stored order,
 * drops any id that didn't survive, and falls the active id back to the first
 * surviving tab when the stored active was pruned.
 */
export function restoreTabs<T extends HasId>(
  stored: StoredTabs,
  fetched: readonly T[],
): TabsState<T> {
  const byId = new Map(fetched.map((n) => [n.id, n]));
  const tabs = stored.ids
    .map((id) => byId.get(id))
    .filter((n): n is T => n !== undefined);
  const activeId =
    stored.activeId && tabs.some((t) => t.id === stored.activeId)
      ? stored.activeId
      : (tabs[0]?.id ?? null);
  return { tabs, activeId };
}
