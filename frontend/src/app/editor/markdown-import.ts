import type { ProseMirrorDoc, ProseMirrorMark, ProseMirrorNode } from '@perpetuum-nota/shared';

/**
 * Minimal Markdown → ProseMirror/TipTap JSON parser, the inverse of
 * markdown-export.ts. Used by the editor's paste handler so pasting Markdown
 * text produces formatted content rather than a literal block of plain text.
 *
 * Scope (matches what the editor can render and what docToMarkdown emits):
 *   Block: headings (#…######), bullet / ordered lists, task lists
 *          (`- [ ]` / `- [x]`, nestable), fenced code blocks (``` lang),
 *          blockquotes (`>`), horizontal rules, paragraphs.
 *   Inline: bold (** __), italic (* _), strike (~~), inline code (`),
 *           links ([text](url)).
 *
 * Deliberately NOT a full CommonMark implementation — it targets the subset
 * this app round-trips. Anything unrecognised falls through as paragraph text.
 */
export function markdownToProseMirror(md: string): ProseMirrorDoc {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const content = parseBlocks(lines, 0, lines.length);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

// A line that starts a list item: optional indent, a bullet (-,*,+) or ordered
// (`1.`) marker, an optional `[ ]`/`[x]` checkbox, then the item text.
const ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(\[([ xX])\]\s+)?(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^```(.*)$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_RE = /^>\s?(.*)$/;

/** Parses the lines in [start, end) into an array of block nodes. */
function parseBlocks(lines: string[], start: number, end: number): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  let i = start;

  while (i < end) {
    const line = lines[i];

    // Blank line — separates blocks, no output.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(FENCE_RE);
    if (fence) {
      const language = fence[1].trim();
      const code: string[] = [];
      i++;
      while (i < end && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence (if present)
      out.push({
        type: 'codeBlock',
        attrs: { language: language || null },
        content: code.length ? [{ type: 'text', text: code.join('\n') }] : [],
      });
      continue;
    }

    // Heading.
    const heading = line.match(HEADING_RE);
    if (heading) {
      out.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(line)) {
      out.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Blockquote — gather consecutive `>` lines and parse their inner Markdown.
    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < end && QUOTE_RE.test(lines[i])) {
        inner.push(lines[i].match(QUOTE_RE)![1]);
        i++;
      }
      out.push({ type: 'blockquote', content: parseBlocks(inner, 0, inner.length) });
      continue;
    }

    // List (bullet / ordered / task).
    if (ITEM_RE.test(line)) {
      const { node, next } = parseList(lines, i, end, indentOf(line));
      out.push(node);
      i = next;
      continue;
    }

    // Paragraph — gather consecutive plain lines until a blank or a block start.
    const para: string[] = [];
    while (i < end && lines[i].trim() !== '' && !startsBlock(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push({ type: 'paragraph', content: parseInline(para.join(' ')) });
  }

  return out;
}

/** True if a line begins a non-paragraph block (so paragraph gathering stops). */
function startsBlock(line: string): boolean {
  return (
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    ITEM_RE.test(line)
  );
}

function indentOf(line: string): number {
  return (line.match(/^(\s*)/)?.[1].length) ?? 0;
}

/**
 * Parses a run of list items at a given indent into a single list node.
 * Nested lists (deeper indent) recurse and attach to their parent item.
 * A change of list kind (bullet ↔ ordered ↔ task) at the same indent ends
 * the current list.
 */
function parseList(
  lines: string[],
  start: number,
  end: number,
  indent: number,
): { node: ProseMirrorNode; next: number } {
  const items: ProseMirrorNode[] = [];
  let kind: 'bullet' | 'ordered' | 'task' | null = null;
  let i = start;

  while (i < end) {
    const m = lines[i].match(ITEM_RE);
    if (!m) break;
    const ind = m[1].length;
    if (ind !== indent) break; // smaller → caller handles; larger → handled below

    const isTask = m[3] !== undefined;
    const isOrdered = /\d/.test(m[2]);
    const thisKind = isTask ? 'task' : isOrdered ? 'ordered' : 'bullet';
    if (kind === null) kind = thisKind;
    else if (kind !== thisKind) break;

    const itemContent: ProseMirrorNode[] = [
      { type: 'paragraph', content: parseInline(m[5].trim()) },
    ];
    i++;

    // Attach a nested list if the following item is indented deeper.
    if (i < end) {
      const childMatch = lines[i].match(ITEM_RE);
      if (childMatch && childMatch[1].length > indent) {
        const child = parseList(lines, i, end, childMatch[1].length);
        itemContent.push(child.node);
        i = child.next;
      }
    }

    if (isTask) {
      items.push({
        type: 'taskItem',
        attrs: { checked: /x/i.test(m[4] ?? '') },
        content: itemContent,
      });
    } else {
      items.push({ type: 'listItem', content: itemContent });
    }
  }

  const type =
    kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList';
  return { node: { type, content: items }, next: i };
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

interface Matcher {
  re: RegExp;
  mark?: ProseMirrorMark['type'];
  literal?: boolean; // code: don't parse inside
  link?: boolean; // capture group 2 = href, recurse group 1
}

// Order matters only as a tie-breaker when two matchers hit the same index;
// strong (**, __) is listed before emphasis (*, _) so `**x**` reads as bold.
const MATCHERS: Matcher[] = [
  { re: /`([^`]+)`/, mark: 'code', literal: true },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, link: true },
  { re: /\*\*([^*]+)\*\*/, mark: 'bold' },
  { re: /__([^_]+)__/, mark: 'bold' },
  { re: /~~([^~]+)~~/, mark: 'strike' },
  { re: /\*([^*]+)\*/, mark: 'italic' },
  { re: /(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/, mark: 'italic' },
];

/** Parses inline Markdown into an array of text nodes carrying marks. */
function parseInline(text: string, marks: ProseMirrorMark[] = []): ProseMirrorNode[] {
  if (text === '') return [];

  // Find the earliest-matching inline construct.
  let best: { index: number; matcher: Matcher; m: RegExpMatchArray } | null = null;
  for (const matcher of MATCHERS) {
    const m = text.match(matcher.re);
    if (m && m.index !== undefined) {
      if (best === null || m.index < best.index) {
        best = { index: m.index, matcher, m };
      }
    }
  }

  if (!best) {
    return [textNode(text, marks)];
  }

  const { index, matcher, m } = best;
  const nodes: ProseMirrorNode[] = [];

  // Plain text before the match keeps the current marks.
  if (index > 0) nodes.push(textNode(text.slice(0, index), marks));

  if (matcher.literal) {
    // Inline code: literal content, no nested parsing.
    nodes.push(textNode(m[1], addMark(marks, { type: 'code' })));
  } else if (matcher.link) {
    nodes.push(
      ...parseInline(m[1], addMark(marks, { type: 'link', attrs: { href: m[2] } })),
    );
  } else {
    nodes.push(...parseInline(m[1], addMark(marks, { type: matcher.mark! })));
  }

  // Recurse on the remainder after the matched token.
  const rest = text.slice(index + m[0].length);
  nodes.push(...parseInline(rest, marks));

  return nodes.filter((n) => !(n.type === 'text' && n.text === ''));
}

function textNode(text: string, marks: ProseMirrorMark[]): ProseMirrorNode {
  return marks.length ? { type: 'text', text, marks: [...marks] } : { type: 'text', text };
}

function addMark(marks: ProseMirrorMark[], mark: ProseMirrorMark): ProseMirrorMark[] {
  if (marks.some((x) => x.type === mark.type)) return marks;
  return [...marks, mark];
}

// ---------------------------------------------------------------------------
// Heuristic: does this text look like Markdown worth parsing?
// ---------------------------------------------------------------------------

const MARKDOWN_SIGNALS: RegExp[] = [
  /^#{1,6}\s/m, // heading
  /^\s*([-*+]|\d+[.)])\s+/m, // list item
  /^\s*[-*+]\s+\[[ xX]\]/m, // task checkbox
  /^>\s/m, // blockquote
  /^```/m, // code fence
  /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m, // horizontal rule
  /\*\*[^*\n]+\*\*/, // bold
  /~~[^~\n]+~~/, // strike
  /`[^`\n]+`/, // inline code
  /\[[^\]\n]+\]\([^)\s]+\)/, // link
];

/**
 * True when `text` contains at least one structural Markdown marker. The paste
 * handler only re-parses plain text that looks like Markdown, so pasting an
 * ordinary sentence is left untouched (no surprise reformatting).
 */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_SIGNALS.some((re) => re.test(text));
}
