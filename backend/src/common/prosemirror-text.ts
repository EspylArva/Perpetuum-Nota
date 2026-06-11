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
 * Extracts a short plain-text preview from a ProseMirror/TipTap doc, preserving
 * line breaks between blocks and at explicit hard breaks (so multi-line notes
 * keep their structure on wall cards). Only spaces/tabs are collapsed.
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

/** True if the value looks like a ProseMirror document node. */
export function isProseMirrorDoc(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'doc'
  );
}
