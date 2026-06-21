import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { sinkSelectedListItem } from './list-indent';

// A minimal schema mirroring the real editor's list shapes: lists are
// homogeneous, items allow a nested sublist (`paragraph block*`).
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    bulletList: { group: 'block', content: 'listItem+' },
    orderedList: { group: 'block', content: 'listItem+' },
    taskList: { group: 'block', content: 'taskItem+' },
    listItem: { content: 'paragraph block*' },
    taskItem: {
      content: 'paragraph block*',
      attrs: { checked: { default: false } },
    },
  },
});

const p = (t: string) => schema.node('paragraph', null, t ? [schema.text(t)] : []);
const li = (...c: PMNode[]) => schema.node('listItem', null, c);
const ti = (checked: boolean, ...c: PMNode[]) =>
  schema.node('taskItem', { checked }, c);
const ul = (...items: PMNode[]) => schema.node('bulletList', null, items);
const tl = (...items: PMNode[]) => schema.node('taskList', null, items);
const doc = (...c: PMNode[]) => schema.node('doc', null, c);

/** Position of the cursor just after the first occurrence of `char`. */
function cursorAfter(d: PMNode, char: string): number {
  let found = -1;
  d.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(char)) {
      found = pos + (node.text.indexOf(char) + 1);
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error(`no text "${char}"`);
  return found;
}

/** Runs the sink command on a doc with the cursor in `char`, returns new doc. */
function sink(d: PMNode, char: string): PMNode | null {
  const state = EditorState.create({
    doc: d,
    selection: TextSelection.create(d, cursorAfter(d, char)),
  });
  let next: PMNode | null = null;
  const handled = sinkSelectedListItem(state, (tr) => {
    next = state.apply(tr).doc;
  });
  return handled ? next : null;
}

describe('sinkSelectedListItem', () => {
  it('nests a checkbox under the previous checkbox (same list)', () => {
    const before = doc(tl(ti(false, p('a')), ti(false, p('b'))));
    const after = sink(before, 'b');
    expect(after?.toJSON()).toEqual(
      doc(tl(ti(false, p('a'), tl(ti(false, p('b')))))).toJSON(),
    );
  });

  it('nests a bullet item under the previous bullet item (same list)', () => {
    const before = doc(ul(li(p('a')), li(p('b'))));
    const after = sink(before, 'b');
    expect(after?.toJSON()).toEqual(
      doc(ul(li(p('a'), ul(li(p('b')))))).toJSON(),
    );
  });

  it('merges into an existing sublist of the same kind', () => {
    const before = doc(tl(ti(false, p('a'), tl(ti(false, p('b')))), ti(false, p('c'))));
    const after = sink(before, 'c');
    expect(after?.toJSON()).toEqual(
      doc(tl(ti(false, p('a'), tl(ti(false, p('b')), ti(false, p('c')))))).toJSON(),
    );
  });

  it('nests a checkbox under a preceding bullet list (cross-kind, first item)', () => {
    // A bullet list followed by a checklist — Tab on the first checkbox.
    const before = doc(ul(li(p('Groceries'))), tl(ti(false, p('milk')), ti(false, p('eggs'))));
    const after = sink(before, 'milk');
    expect(after?.toJSON()).toEqual(
      doc(
        ul(li(p('Groceries'), tl(ti(false, p('milk'))))),
        tl(ti(false, p('eggs'))),
      ).toJSON(),
    );
  });

  it('removes the now-empty source list when its only item moves', () => {
    const before = doc(ul(li(p('Groceries'))), tl(ti(false, p('milk'))));
    const after = sink(before, 'milk');
    expect(after?.toJSON()).toEqual(
      doc(ul(li(p('Groceries'), tl(ti(false, p('milk')))))).toJSON(),
    );
  });

  it('keeps the cursor inside the moved checkbox', () => {
    const before = doc(tl(ti(false, p('a')), ti(false, p('hello'))));
    const state = EditorState.create({
      doc: before,
      selection: TextSelection.create(before, cursorAfter(before, 'h')),
    });
    let next = state;
    sinkSelectedListItem(state, (tr) => {
      next = state.apply(tr);
    });
    // The cursor should sit within a text node reading "hello".
    const around = next.doc.resolve(next.selection.from).parent.textContent;
    expect(around).toBe('hello');
  });

  it('is a no-op for the first item with no preceding list', () => {
    const before = doc(tl(ti(false, p('only'))));
    expect(sink(before, 'only')).toBeNull();
  });

  it('is a no-op outside any list', () => {
    const before = doc(p('plain'));
    expect(sink(before, 'plain')).toBeNull();
  });

  it('does not nest under a preceding non-list block', () => {
    const before = doc(p('intro'), tl(ti(false, p('milk'))));
    expect(sink(before, 'milk')).toBeNull();
  });
});
