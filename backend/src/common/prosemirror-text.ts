// Minimal default document so the editor always has a paragraph to type in.
export const EMPTY_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

interface MaybeNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: Record<string, unknown>;
}

/** The inline atom node the editor stores for a `[[wikilink]]`. */
const WIKILINK_NODE = 'wikilink';

/** Reads the trimmed title from a `wikilink` node's attrs (empty if absent). */
function wikilinkNodeTitle(n: MaybeNode): string {
  const title = n.attrs?.['title'];
  return typeof title === 'string' ? title.trim() : '';
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
    // Wikilink pills are atoms: contribute their title so search matches it.
    if (n.type === WIKILINK_NODE) {
      out += wikilinkNodeTitle(n);
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
 * patterns. An optional `#anchor` section reference inside the link (e.g.
 * `[[Note#Heading]]`) is stripped here — only the part BEFORE the first `#` is
 * the title (the anchor is a frontend scroll target, not part of the target
 * note). Titles are trimmed; empty `[[]]`, whitespace-only, and anchor-only
 * links like `[[#heading]]` (empty title) are ignored; results are
 * de-duplicated case-insensitively, preserving the FIRST-seen original casing.
 * Resolution to a note id (done elsewhere) is case-insensitive.
 *
 * Per-text-run: a `[[...]]` that straddles two adjacent text nodes (different
 * marks, a hard break, etc.) is not detected — only patterns wholly inside a
 * single text run match. Pure (no I/O), mirroring the other walkers here.
 */
export function extractWikilinks(doc: unknown): string[] {
  const seen = new Map<string, string>(); // lowercased → first-seen original
  const add = (rawTitle: string): void => {
    const title = rawTitle.trim();
    if (!title) return;
    const key = title.toLowerCase();
    if (!seen.has(key)) seen.set(key, title);
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as MaybeNode;
    // Current form: an atomic `wikilink` node carrying the title in attrs.
    if (n.type === WIKILINK_NODE) {
      add(wikilinkNodeTitle(n).split('#', 1)[0]);
      return;
    }
    // Legacy form: `[[Title]]` still stored as plain text (pre-node notes).
    if (typeof n.text === 'string') {
      for (const m of n.text.matchAll(WIKILINK)) {
        // Drop any `#section` anchor: keep only the part before the first `#`.
        add(m[1].split('#', 1)[0]);
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return [...seen.values()];
}

/**
 * Returns a deep copy of `doc` with every wikilink that targets `oldTitle`
 * (case-insensitively, by the title BEFORE any `#anchor`) rewritten to
 * `newTitle`, plus a `changed` flag. Covers both the current `wikilink` node
 * form (rewrites `attrs.title`) and the legacy `[[Title]]` text form. Used to
 * keep referencing notes' bodies in sync when a target note is renamed.
 *
 * Pure (no I/O). The `#anchor` portion of a link is preserved; only the title
 * segment is swapped.
 */
export function renameWikilinks(
  doc: unknown,
  oldTitle: string,
  newTitle: string,
): { doc: unknown; changed: boolean } {
  const want = oldTitle.trim().toLowerCase();
  let changed = false;
  if (!want) return { doc, changed };

  const clone = JSON.parse(JSON.stringify(doc)) as unknown;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as MaybeNode;

    if (n.type === WIKILINK_NODE && n.attrs) {
      const title = wikilinkNodeTitle(n);
      if (title.toLowerCase() === want) {
        n.attrs['title'] = newTitle;
        changed = true;
      }
      return;
    }

    if (typeof n.text === 'string' && n.text.includes('[[')) {
      const rewritten = n.text.replace(WIKILINK, (full, inner: string) => {
        const hash = inner.indexOf('#');
        const titlePart = hash === -1 ? inner : inner.slice(0, hash);
        const anchor = hash === -1 ? '' : inner.slice(hash); // includes leading '#'
        if (titlePart.trim().toLowerCase() !== want) return full;
        changed = true;
        return `[[${newTitle}${anchor}]]`;
      });
      (n as { text?: unknown }).text = rewritten;
    }

    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(clone);
  return { doc: clone, changed };
}

/** True if the value looks like a ProseMirror document node. */
export function isProseMirrorDoc(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'doc'
  );
}
