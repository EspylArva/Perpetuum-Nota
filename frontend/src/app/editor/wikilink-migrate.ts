import type { ProseMirrorDoc, ProseMirrorNode } from '@perpetuum-nota/shared';
import { parseWikiTarget, scanWikilinks } from './wikilink-parse';
import { WIKILINK_NODE_NAME } from './wikilink-node';

/**
 * Converts legacy `[[Title]]` text runs in a stored ProseMirror doc into atomic
 * `wikilink` nodes, so notes saved before the node migration still render (and
 * behave) as pills when loaded into the editor.
 *
 * Pure JSON→JSON transform (returns a new doc; the input is not mutated). It is
 * applied wherever stored content enters the editor — once such a note is edited
 * and re-saved, its content is persisted in node form and no longer needs this.
 *
 * A `[[…]]` whose inner text doesn't parse to a non-empty title (e.g. `[[]]`,
 * `[[#x]]`) is left as plain text. Marks on the surrounding text are preserved
 * on the split-out text segments; the link node itself carries no marks.
 */
export function migrateWikilinkText(doc: ProseMirrorDoc): ProseMirrorDoc {
  return mapNode(doc as ProseMirrorNode) as ProseMirrorDoc;
}

function mapNode(node: ProseMirrorNode): ProseMirrorNode {
  if (!Array.isArray(node.content)) return node;

  const content: ProseMirrorNode[] = [];
  for (const child of node.content) {
    if (child.type === 'text' && typeof child.text === 'string') {
      content.push(...splitTextNode(child));
    } else {
      content.push(mapNode(child));
    }
  }
  return { ...node, content };
}

/** Splits a text node into alternating text / wikilink-node segments. */
function splitTextNode(node: ProseMirrorNode): ProseMirrorNode[] {
  const text = node.text ?? '';
  const matches = scanWikilinks(text);
  if (matches.length === 0) return [node];

  const out: ProseMirrorNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    const target = parseWikiTarget(match.inner);
    if (!target) continue; // leave un-parseable `[[…]]` as literal text
    if (match.from > cursor) {
      out.push(textSegment(node, text.slice(cursor, match.from)));
    }
    out.push({
      type: WIKILINK_NODE_NAME,
      attrs: { title: target.title, heading: target.heading },
    });
    cursor = match.to;
  }
  if (cursor < text.length) {
    out.push(textSegment(node, text.slice(cursor)));
  }
  // If every match was skipped, fall back to the original node unchanged.
  return out.length > 0 ? out : [node];
}

/** A text node carrying `slice` and the original node's marks. */
function textSegment(source: ProseMirrorNode, slice: string): ProseMirrorNode {
  return source.marks
    ? { type: 'text', text: slice, marks: source.marks }
    : { type: 'text', text: slice };
}
