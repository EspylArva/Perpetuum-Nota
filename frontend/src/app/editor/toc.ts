import type { ProseMirrorDoc, ProseMirrorNode } from '@perpetuum-nota/shared';

/** One entry in the table of contents. */
export interface TocEntry {
  level: number;
  text: string;
  /** ProseMirror document position of the heading node (before its opening token). */
  pos: number;
}

/**
 * Extracts a flat list of headings from a ProseMirror document.
 *
 * Only top-level children of the doc are inspected — in TipTap, heading nodes
 * are always direct children of the root doc, never nested inside lists or
 * blockquotes.
 *
 * Position accounting follows the ProseMirror model:
 *   - A non-leaf node occupies nodeSize = 2 (opening + closing tokens) + content size.
 *   - A text node occupies nodeSize = text.length (no tokens).
 *   - Each child's position is the sum of the sizes of all previous siblings.
 */
export function extractToc(doc: ProseMirrorDoc): TocEntry[] {
  const entries: TocEntry[] = [];
  const topLevel = doc.content ?? [];
  let pos = 0;

  for (const node of topLevel) {
    if (node.type === 'heading') {
      const level = (node.attrs?.['level'] as number | undefined) ?? 1;
      const text = extractPlainText(node);
      entries.push({ level, text, pos });
    }
    pos += nodeSize(node);
  }

  return entries;
}

/**
 * Computes the hierarchical outline number for each TOC entry (e.g. "1", "1.1",
 * "1.1.1"), index-aligned to `entries`. A heading increments its own level and
 * resets all deeper counters, so sub-numbers restart under each higher heading.
 *
 * This mirrors the editor's CSS counters exactly — including leading zeros when
 * a document opens below H1 (e.g. a lone H3 reads "0.0.1") — so the editor and
 * the ToC always agree.
 */
export function headingNumbers(entries: TocEntry[]): string[] {
  const counters = [0, 0, 0, 0, 0]; // levels 1..5
  return entries.map((e) => {
    const lvl = Math.min(5, Math.max(1, e.level));
    counters[lvl - 1]++;
    for (let i = lvl; i < counters.length; i++) counters[i] = 0;
    return counters.slice(0, lvl).join('.');
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// True atom/leaf node types: they have no opening+closing tokens — just 1 token.
// Empty non-leaf nodes (paragraph, heading, codeBlock, blockquote …) still get
// 2 tokens even when their content array is empty.
const LEAF_TYPES = new Set([
  'image',
  'horizontalRule',
  'hardBreak',
  'inlineMath',
  'blockMath',
  'wikilink',
]);

/**
 * Recursively computes the ProseMirror nodeSize for a JSON node:
 *   - text node       → text.length
 *   - atom/leaf node  → 1  (image, horizontalRule, hardBreak, inlineMath, blockMath)
 *   - non-leaf node   → 2 + sum(nodeSize of children)  (even when content is empty)
 */
function nodeSize(node: ProseMirrorNode): number {
  if (node.type === 'text') {
    return (node.text ?? '').length;
  }
  if (LEAF_TYPES.has(node.type)) {
    return 1;
  }
  const children = node.content ?? [];
  return 2 + children.reduce((sum, child) => sum + nodeSize(child), 0);
}

/** Extracts raw text content from a node, ignoring marks. */
function extractPlainText(node: ProseMirrorNode): string {
  if (node.type === 'text') return node.text ?? '';
  // Wikilink pills are atoms (no content) — surface their title so a heading
  // like "See [[Other]]" still contributes "Other" to the ToC label.
  if (node.type === 'wikilink') return (node.attrs?.['title'] as string) ?? '';
  return (node.content ?? []).map(extractPlainText).join('');
}
