/**
 * Pure helpers for `[[wikilink]]` parsing — no ProseMirror / Angular imports, so
 * the regex and parsing rules are unit-testable in isolation (mirrors the
 * matcher/wiring split used by markdown-link-rule.ts).
 *
 * `[[Title]]` and `[[Title#Heading]]` links are stored as PLAIN TEXT in the
 * ProseMirror doc; the backend extracts them with the same per-text-run regex
 * used by `scanWikilinks` below, so the in-editor decoration layer and the
 * backend's link graph stay in agreement.
 */

/** A parsed wikilink target: a note title plus an optional `#heading` anchor. */
export interface WikiTarget {
  /** The note title (text before the first `#`), trimmed. */
  title: string;
  /** The heading slug source (text after the first `#`), trimmed; null if none. */
  heading: string | null;
  /** The trimmed inner text exactly as written (title plus `#heading` if present). */
  raw: string;
}

/**
 * Parses the inner text of `[[inner]]` into a {@link WikiTarget}.
 *
 * Splits on the FIRST `#` so a title never contains `#` but a heading may
 * (`[[Note#Section#Sub]]` → heading `'Section#Sub'`). Returns null when the
 * title is empty after trimming (e.g. `[[]]`, `[[   ]]`, or `[[#Heading]]`).
 */
export function parseWikiTarget(inner: string): WikiTarget | null {
  const hashIndex = inner.indexOf('#');
  let title: string;
  let heading: string | null;

  if (hashIndex === -1) {
    title = inner.trim();
    heading = null;
  } else {
    title = inner.slice(0, hashIndex).trim();
    heading = inner.slice(hashIndex + 1).trim();
  }

  if (title === '') return null;

  const raw = heading !== null ? `${title}#${heading}` : title;
  return { title, heading, raw };
}

/** One `[[…]]` span found in a single text string. */
export interface WikiMatch {
  /** Start offset of `[[` within the scanned string. */
  from: number;
  /** End offset (one past the final `]`) within the scanned string. */
  to: number;
  /** The inner text between the brackets (not trimmed). */
  inner: string;
}

// `[[ … ]]` where the inner run contains no further brackets. Mirrors the
// backend's per-text-run extraction so editor decorations and the link graph
// agree on what counts as a wikilink.
const WIKILINK = /\[\[([^[\]]*)\]\]/g;

/**
 * Finds every `[[…]]` span in a single text string, returning each match's
 * start/end offsets (relative to the string) and inner text. Offsets are meant
 * to be added to a ProseMirror text node's start position to build decorations.
 *
 * Empty links (`[[]]`) are returned too (with `inner: ''`); callers decide
 * whether to skip them — `parseWikiTarget('')` returns null, so they never
 * resolve to a note.
 */
export function scanWikilinks(text: string): WikiMatch[] {
  const matches: WikiMatch[] = [];
  // Fresh lastIndex each call (the regex is module-level + global).
  WIKILINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK.exec(text)) !== null) {
    matches.push({
      from: m.index,
      to: m.index + m[0].length,
      inner: m[1],
    });
    // Guard against zero-width matches (not possible here, but defensive).
    if (m.index === WIKILINK.lastIndex) WIKILINK.lastIndex++;
  }
  return matches;
}

/**
 * Slugifies heading text for matching a `[[Note#Heading]]` anchor to a heading
 * node's text: lowercase, trim, collapse whitespace runs to a single `-`, then
 * strip everything that isn't a lowercase alphanumeric or `-`.
 *
 * e.g. `slugifyHeading('  My Cool Section! ')` → `'my-cool-section'`.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}
