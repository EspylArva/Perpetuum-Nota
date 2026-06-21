import { Extension } from '@tiptap/core';
import type { Node as PMNode, NodeType, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';

/**
 * Cross-kind list indentation.
 *
 * The stock `sinkListItem(type)` only nests an item under a previous sibling of
 * the SAME kind and SAME list, so a checkbox can never become a sub-item of a
 * bullet/ordered list. This command makes Tab indent any list item one level,
 * covering two cases:
 *
 *   A. The item has a previous sibling IN THE SAME list — nest it under that
 *      sibling (same as the stock behaviour, any kind).
 *   B. The item is FIRST in its list, but that list immediately follows another
 *      list block (e.g. a checklist right after a bullet list) — nest it under
 *      the previous list's last item. This is how "a checkbox becomes a
 *      sub-item of a list" actually happens, since a bullet list can't directly
 *      contain a task item.
 *
 * The moved item is wrapped in (or merged into) a nested sublist of its OWN
 * kind, which both `listItem` and `taskItem` accept (content `paragraph
 * block*`), so checkbox-ness is preserved.
 */

const ITEM_TYPES = new Set(['listItem', 'taskItem']);
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

interface FoundItem {
  depth: number;
  node: PMNode;
  before: number;
  after: number;
}

function isListNode(node: PMNode | null | undefined): node is PMNode {
  return !!node && LIST_TYPES.has(node.type.name);
}

/** Nearest enclosing list item (taskItem/listItem) around a resolved position. */
function findListItem($pos: ResolvedPos): FoundItem | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (ITEM_TYPES.has(node.type.name)) {
      return { depth: d, node, before: $pos.before(d), after: $pos.after(d) };
    }
  }
  return null;
}

/**
 * Appends `moved` into `targetItem` as a nested sublist of `listType`, merging
 * into an existing trailing sublist of the same kind when present. `targetInner`
 * is the position just inside `targetItem`, before its closing token. Returns
 * the document position where the moved item's content begins (for the cursor).
 */
function appendAsSublist(
  tr: Transaction,
  targetItem: PMNode,
  targetInner: number,
  listType: NodeType,
  moved: PMNode,
  offset: number,
): number {
  const last = targetItem.lastChild;
  if (last && last.type === listType) {
    // Merge into the existing sublist (its inner end is one inside targetInner).
    const insertPos = targetInner - 1;
    tr.insert(insertPos, moved);
    return insertPos + offset;
  }
  tr.insert(targetInner, listType.create(null, moved));
  return targetInner + 1 + offset;
}

/**
 * Indents the list item containing the selection one level. Returns false (a
 * no-op) when the selection isn't inside a single list item, or there is
 * nowhere to nest it.
 */
export function sinkSelectedListItem(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from, $to } = state.selection;
  const item = findListItem($from);
  if (!item) return false;
  // Only a selection wholly inside one item is handled.
  if ($to.pos > item.after) return false;

  const listDepth = item.depth - 1;
  const list = $from.node(listDepth);
  const index = $from.index(listDepth);
  const offset = $from.pos - item.before; // cursor offset within the moved item

  // --- Case A: previous sibling in the same list ---
  if (index > 0) {
    const prevItem = list.child(index - 1);
    const prevInner = item.before - 1; // inside prevItem, before its close
    const tr = state.tr;
    tr.delete(item.before, item.after);
    const cursor = appendAsSublist(
      tr,
      prevItem,
      prevInner,
      list.type,
      item.node,
      offset,
    );
    finish(tr, cursor, dispatch);
    return true;
  }

  // --- Case B: first item; nest under the preceding sibling LIST block ---
  const listBefore = $from.before(listDepth);
  const listAfter = $from.after(listDepth);
  const parentIndex = $from.index(listDepth - 1);
  if (parentIndex === 0) return false; // no preceding block
  const prevBlock = $from.node(listDepth - 1).child(parentIndex - 1);
  if (!isListNode(prevBlock)) return false; // only nest under a preceding list
  const targetItem = prevBlock.lastChild;
  if (!targetItem) return false;

  // targetItem is prevBlock's last child; its inner end sits two tokens before
  // the start of the current list (prevBlock close, then targetItem close).
  const targetInner = listBefore - 2;
  const onlyChild = list.childCount === 1;

  const tr = state.tr;
  // Remove the source first (it lives AFTER the insertion point, so insert
  // positions stay valid). Drop the whole list if this was its only item.
  if (onlyChild) tr.delete(listBefore, listAfter);
  else tr.delete(item.before, item.after);

  const cursor = appendAsSublist(
    tr,
    targetItem,
    targetInner,
    list.type,
    item.node,
    offset,
  );
  finish(tr, cursor, dispatch);
  return true;
}

function finish(
  tr: Transaction,
  cursor: number,
  dispatch?: (tr: Transaction) => void,
): void {
  const target = Math.max(0, Math.min(cursor, tr.doc.content.size));
  tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
  if (dispatch) dispatch(tr.scrollIntoView());
}

/**
 * Keymap that makes Tab indent ANY list item (bullets, ordered, checkboxes),
 * including across kinds. Higher priority than the stock list extensions so it
 * owns Tab; returns false (lets other handlers / the browser act) when the item
 * can't be indented. Shift-Tab is left to the stock `liftListItem` handlers,
 * which already outdent each kind.
 */
export const ListIndentKeymap = Extension.create({
  name: 'listIndentKeymap',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: () =>
        sinkSelectedListItem(this.editor.state, this.editor.view.dispatch),
    };
  },
});
