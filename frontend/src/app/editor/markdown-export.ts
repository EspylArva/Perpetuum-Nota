import type { ProseMirrorDoc, ProseMirrorMark, ProseMirrorNode } from '@stickynotes/shared';

/**
 * Converts a ProseMirror/TipTap JSON document to Markdown.
 *
 * Pure function — no editor instance required. Covers every node/mark this
 * app produces (see extensions.ts, math.ts, floating-image.ts).
 *
 * NOT implemented intentionally (YAGNI): escaping of literal Markdown
 * characters inside text content (e.g. * _ ` [ etc). The exported Markdown
 * is meant for round-tripping through standard Markdown renderers where that
 * level of escaping is rarely needed for note content.
 */
export function docToMarkdown(doc: ProseMirrorDoc): string {
  const blocks = renderChildren(doc.content ?? [], 0);
  return blocks.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Block-level rendering
// ---------------------------------------------------------------------------

/**
 * Renders an array of nodes at a given list nesting depth.
 * Returns one string per block-level node (already joined inside nested lists).
 */
function renderChildren(nodes: ProseMirrorNode[], listDepth: number): string[] {
  const out: string[] = [];
  let orderedCounter = 0;

  for (const node of nodes) {
    const block = renderBlock(node, listDepth, orderedCounter);
    if (block !== null) {
      out.push(block);
      // Track ordered list counters — we increment for every listItem sibling
      // inside an orderedList; the counter resets when we enter a fresh call.
    }
    if (node.type === 'listItem') orderedCounter++;
  }

  return out;
}

/**
 * Render a single block-level node.  Returns null for nodes that produce no
 * output (e.g. an empty paragraph).
 */
function renderBlock(node: ProseMirrorNode, listDepth: number, orderedIndex: number): string | null {
  switch (node.type) {
    case 'paragraph': {
      const inline = renderInlineContent(node.content ?? []);
      return inline || null;
    }

    case 'heading': {
      const level = (node.attrs?.['level'] as number | undefined) ?? 1;
      const prefix = '#'.repeat(Math.min(6, Math.max(1, level)));
      const inline = renderInlineContent(node.content ?? []);
      return `${prefix} ${inline}`;
    }

    case 'codeBlock': {
      const lang = (node.attrs?.['language'] as string | undefined) ?? '';
      const code = renderInlineContent(node.content ?? []);
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case 'blockquote': {
      // Recursively render children then prefix every line with "> ".
      const inner = renderChildren(node.content ?? [], listDepth).join('\n\n');
      return prefixLines(inner, '> ');
    }

    case 'bulletList': {
      return renderList(node.content ?? [], listDepth, 'bullet');
    }

    case 'orderedList': {
      return renderList(node.content ?? [], listDepth, 'ordered');
    }

    case 'taskList': {
      return renderTaskList(node.content ?? [], listDepth);
    }

    case 'listItem': {
      // listItem is always rendered by renderList which controls the prefix.
      // This branch handles the rare case where it appears at top-level.
      return renderListItemBody(node, listDepth);
    }

    case 'image': {
      // FloatingImage is configured inline:false, so images are TOP-LEVEL block
      // nodes (direct children of doc), not wrapped in a paragraph.
      const src = (node.attrs?.['src'] as string | undefined) ?? '';
      return `![](${src})`;
    }

    case 'blockMath': {
      const latex = (node.attrs?.['latex'] as string | undefined) ?? '';
      return `$$${latex}$$`;
    }

    case 'horizontalRule': {
      return '---';
    }

    default: {
      // Unknown block node: fall back to its text content so we never throw.
      const text = extractText(node);
      return text || null;
    }
  }
}

// ---------------------------------------------------------------------------
// List rendering
// ---------------------------------------------------------------------------

function renderList(
  items: ProseMirrorNode[],
  depth: number,
  kind: 'bullet' | 'ordered',
): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  items.forEach((item, idx) => {
    const prefix = kind === 'ordered' ? `${idx + 1}. ` : '- ';
    const body = renderListItemBody(item, depth + 1);
    // The first line of the body gets the bullet; subsequent lines already
    // carry their own indentation from deeper render calls.
    const firstLineEnd = body.indexOf('\n');
    if (firstLineEnd === -1) {
      lines.push(`${indent}${prefix}${body}`);
    } else {
      lines.push(`${indent}${prefix}${body.slice(0, firstLineEnd)}`);
      lines.push(body.slice(firstLineEnd + 1));
    }
  });

  return lines.join('\n');
}

function renderListItemBody(item: ProseMirrorNode, childDepth: number): string {
  const children = item.content ?? [];
  const parts: string[] = [];

  for (const child of children) {
    if (child.type === 'paragraph') {
      const inline = renderInlineContent(child.content ?? []);
      if (inline) parts.push(inline);
    } else if (child.type === 'bulletList') {
      parts.push(renderList(child.content ?? [], childDepth, 'bullet'));
    } else if (child.type === 'orderedList') {
      parts.push(renderList(child.content ?? [], childDepth, 'ordered'));
    } else if (child.type === 'taskList') {
      parts.push(renderTaskList(child.content ?? [], childDepth));
    } else {
      const fallback = renderBlock(child, childDepth, 0);
      if (fallback) parts.push(fallback);
    }
  }

  return parts.join('\n');
}

function renderTaskList(items: ProseMirrorNode[], depth: number): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  for (const item of items) {
    const checked = !!(item.attrs?.['checked'] as boolean | undefined);
    const box = checked ? '[x]' : '[ ]';
    const body = renderListItemBody(item, depth + 1);
    lines.push(`${indent}- ${box} ${body}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

function renderInlineContent(nodes: ProseMirrorNode[]): string {
  return nodes.map(renderInline).join('');
}

function renderInline(node: ProseMirrorNode): string {
  switch (node.type) {
    case 'text': {
      const raw = node.text ?? '';
      return applyMarks(raw, node.marks ?? []);
    }

    case 'hardBreak':
      return '  \n';

    case 'image': {
      const src = (node.attrs?.['src'] as string | undefined) ?? '';
      return `![](${src})`;
    }

    case 'inlineMath': {
      const latex = (node.attrs?.['latex'] as string | undefined) ?? '';
      return `$${latex}$`;
    }

    default:
      // Unknown inline node: render its text content.
      return extractText(node);
  }
}

// ---------------------------------------------------------------------------
// Mark application
// ---------------------------------------------------------------------------

// Marks whose rendering requires special treatment, applied outermost → innermost.
// textStyle (color/fontSize) is intentionally dropped here (listed in the
// marks array but handled by the `default` case which returns the text as-is).
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code', 'underline'];

function applyMarks(text: string, marks: ProseMirrorMark[]): string {
  if (marks.length === 0) return text;

  // Sort marks by our preferred wrap order so nesting is predictable.
  const sorted = [...marks].sort((a, b) => {
    const ai = MARK_ORDER.indexOf(a.type);
    const bi = MARK_ORDER.indexOf(b.type);
    // Unknown marks (textStyle etc) go to the end (they'll be dropped).
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  let result = text;
  for (const mark of sorted) {
    result = applyMark(result, mark);
  }
  return result;
}

function applyMark(text: string, mark: ProseMirrorMark): string {
  switch (mark.type) {
    case 'bold':
      return `**${text}**`;
    case 'italic':
      return `*${text}*`;
    case 'strike':
      return `~~${text}~~`;
    case 'code':
      return `\`${text}\``;
    case 'underline':
      return `<u>${text}</u>`;
    case 'link': {
      const href = (mark.attrs?.['href'] as string | undefined) ?? '';
      return `[${text}](${href})`;
    }
    case 'textStyle':
      // Drop color/fontSize marks silently; keep the text.
      return text;
    default:
      return text;
  }
}

// ---------------------------------------------------------------------------
// Blockquote helpers
// ---------------------------------------------------------------------------

/**
 * Prefixes every line of `text` with `prefix`.
 * For blockquotes the convention is:
 *   - content lines get `"> "`
 *   - blank separator lines between paragraphs get `">"` (no trailing space)
 */
function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? prefix.trimEnd() : `${prefix}${line}`))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Recursively collect plain text from any node tree (fallback for unknown nodes). */
function extractText(node: ProseMirrorNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(extractText).join('');
}
