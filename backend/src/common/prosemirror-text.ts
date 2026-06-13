// Minimal default document so the editor always has a paragraph to type in.
export const EMPTY_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

interface MaybeNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

// Block-level nodes whose end should produce a line break in the preview.
const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'codeBlock',
]);

/**
 * Extracts plain text from a ProseMirror/TipTap doc, preserving line breaks
 * between blocks and at explicit hard breaks (so multi-line notes keep their
 * structure on wall cards). Only spaces/tabs are collapsed. `max = Infinity`
 * returns the full text (stored in Note.contentText for search).
 */
export function extractPlainText(doc: unknown, max = 160): string {
  let out = '';
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as MaybeNode;
    if (n.type === 'hardBreak') {
      out += '\n';
      return;
    }
    if (typeof n.text === 'string') out += n.text;
    if (Array.isArray(n.content)) {
      n.content.forEach(walk);
      if (typeof n.type === 'string' && BLOCK_NODES.has(n.type)) out += '\n';
    }
  };
  walk(doc);
  const text = out
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Full searchable text, capped only as a guard against pathological docs. */
export function extractSearchText(doc: unknown): string {
  return extractPlainText(doc, 200_000);
}

/** First-160-chars preview derived from already-extracted text. */
export function previewFromText(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Matches the app-served upload URL (`/api/uploads/:assetId`) in image src attrs.
const UPLOAD_SRC = /^\/api\/uploads\/([0-9a-fA-F-]{36})$/;

/**
 * Collects the ImageAsset ids referenced by image nodes in the doc. Used to
 * sweep asset rows/files whose image was removed from the note body, and to
 * rewrite srcs when duplicating a note.
 */
export function extractReferencedUploadIds(doc: unknown): Set<string> {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as MaybeNode & { attrs?: Record<string, unknown> };
    const src = n.attrs?.['src'];
    if (typeof src === 'string') {
      const m = UPLOAD_SRC.exec(src);
      if (m) ids.add(m[1]);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return ids;
}

/**
 * Returns a deep copy of the doc with upload srcs remapped through `idMap`
 * (old asset id → new asset id). Non-upload srcs pass through untouched.
 */
export function rewriteUploadSrcs(
  doc: unknown,
  idMap: Map<string, string>,
): unknown {
  const clone = JSON.parse(JSON.stringify(doc)) as unknown;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as MaybeNode & { attrs?: Record<string, unknown> };
    const src = n.attrs?.['src'];
    if (typeof src === 'string') {
      const m = UPLOAD_SRC.exec(src);
      const mapped = m && idMap.get(m[1]);
      if (mapped && n.attrs) n.attrs['src'] = `/api/uploads/${mapped}`;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(clone);
  return clone;
}

// Matches `[[inner]]` within a SINGLE text run. `[^\[\]]*` forbids brackets in
// the inner part, so `[[a]]` and `[[a [b] c]]`-style nesting resolves to the
// shortest bracket-free span (the regex won't cross an inner `[`/`]`). Links
// split across separate text nodes (e.g. `[[` in one run and `Title]]` in the
// next) are intentionally NOT matched — extraction is per-text-run.
const WIKILINK = /\[\[([^[\]]*)\]\]/g;

/**
 * Walks the doc's text runs and returns the inner titles of `[[...]]` wikilink
 * patterns. Titles are trimmed; empty `[[]]` (or whitespace-only) are ignored;
 * results are de-duplicated case-insensitively, preserving the FIRST-seen
 * original casing. Resolution to a note id (done elsewhere) is case-insensitive.
 *
 * Per-text-run: a `[[...]]` that straddles two adjacent text nodes (different
 * marks, a hard break, etc.) is not detected — only patterns wholly inside a
 * single text run match. Pure (no I/O), mirroring the other walkers here.
 */
export function extractWikilinks(doc: unknown): string[] {
  const seen = new Map<string, string>(); // lowercased → first-seen original
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as MaybeNode;
    if (typeof n.text === 'string') {
      for (const m of n.text.matchAll(WIKILINK)) {
        const title = m[1].trim();
        if (!title) continue;
        const key = title.toLowerCase();
        if (!seen.has(key)) seen.set(key, title);
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return [...seen.values()];
}

/** True if the value looks like a ProseMirror document node. */
export function isProseMirrorDoc(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'doc'
  );
}
