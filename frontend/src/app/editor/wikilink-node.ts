import {
  Node,
  mergeAttributes,
  nodeInputRule,
  nodePasteRule,
} from '@tiptap/core';
import { parseWikiTarget } from './wikilink-parse';

/**
 * `[[wikilink]]` as an ATOMIC inline node (not plain text + decorations).
 *
 * The earlier design kept links as plain text and painted them with
 * decorations; that made them freely editable — typing next to a pill leaked
 * into the link, and clicking to place the caret beside one navigated. An atom
 * node fixes both by construction:
 *
 *   - `atom: true` → the node is a single indivisible unit. Typing adjacent to
 *     it creates ordinary text OUTSIDE the node; the link itself is never
 *     edited once inserted ("a validated link is not editable").
 *   - the node view owns its own click handler → navigation fires ONLY when the
 *     pill is clicked, never when the caret is merely placed next to it.
 *
 * Storage: the node is persisted as-is in the ProseMirror doc JSON
 * (`{ type: 'wikilink', attrs: { title, heading } }`). The backend understands
 * this node (see prosemirror-text.ts) for link-graph extraction and search.
 * Legacy notes that still hold `[[Title]]` as text are migrated to nodes on
 * load (see wikilink-migrate.ts), and pasted/typed `[[Title]]` is converted via
 * the paste/input rules below.
 */
export interface WikiLinkNodeOptions {
  /** Maps a `[[Title]]` to a note id (case-insensitive), or null if unknown. */
  resolve: (title: string) => string | null;
  /** Opens the target note, optionally scrolling to a `#heading` anchor. */
  navigate: (id: string, heading: string | null) => void;
}

export interface WikiLinkAttrs {
  title: string;
  heading: string | null;
}

export const WIKILINK_NODE_NAME = 'wikilink';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      /** Inserts a `[[wikilink]]` atom at the current selection. */
      insertWikiLink: (attrs: WikiLinkAttrs) => ReturnType;
    };
  }
}

/** `[[Title]]` / `[[Title#Heading]]` serialisation of the node's attrs. */
export function wikiLinkText(attrs: WikiLinkAttrs): string {
  return attrs.heading
    ? `[[${attrs.title}#${attrs.heading}]]`
    : `[[${attrs.title}]]`;
}

/** Pill label: the title, with the heading appended as a subtle `› Heading`. */
function wikiLinkLabel(attrs: WikiLinkAttrs): string {
  return attrs.heading ? `${attrs.title} › ${attrs.heading}` : attrs.title;
}

export const WikiLinkNode = Node.create<WikiLinkNodeOptions>({
  name: WIKILINK_NODE_NAME,
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      resolve: () => null,
      navigate: () => {},
    };
  },

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') ?? '',
        renderHTML: (attrs) => ({ 'data-title': attrs['title'] as string }),
      },
      heading: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-heading') || null,
        renderHTML: (attrs) =>
          attrs['heading'] ? { 'data-heading': attrs['heading'] as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    // Used by getHTML() / HTML export: a self-contained pill span whose text is
    // the link title (readable even without the app's stylesheet).
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': '',
        class: 'wikilink',
      }),
      wikiLinkLabel(node.attrs as WikiLinkAttrs),
    ];
  },

  renderText({ node }) {
    // getText() / plain serialisation falls back to the bracket form.
    return wikiLinkText(node.attrs as WikiLinkAttrs);
  },

  addNodeView() {
    const options = this.options;
    return ({ node }) => {
      const attrs = node.attrs as WikiLinkAttrs;
      const dom = document.createElement('span');
      dom.className = 'wikilink';
      dom.setAttribute('data-wikilink', '');
      // The pill is a single non-editable unit; the caret can sit before/after
      // it but never inside.
      dom.contentEditable = 'false';
      dom.textContent = wikiLinkLabel(attrs);
      dom.title = wikiLinkText(attrs);

      dom.addEventListener('mousedown', (event) => {
        // Navigate on a real click of the pill only. preventDefault stops the
        // caret from being placed (which would otherwise select the atom).
        event.preventDefault();
        const id = options.resolve(attrs.title);
        if (id) options.navigate(id, attrs.heading ?? null);
      });

      return { dom };
    };
  },

  addCommands() {
    return {
      insertWikiLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addInputRules() {
    // Manually typing a complete `[[Title]]` (closing it with `]]`) converts to
    // a pill. The `[[` autocomplete normally inserts the node directly, so this
    // only fires for links typed past the popup.
    return [
      nodeInputRule({
        find: /\[\[([^[\]]+)\]\]$/,
        type: this.type,
        getAttributes: (match) => attrsFromInner(match[1]),
      }),
    ];
  },

  addPasteRules() {
    // Pasted `[[Title]]` text (e.g. from Markdown) becomes pills.
    return [
      nodePasteRule({
        find: /\[\[([^[\]]+)\]\]/g,
        type: this.type,
        getAttributes: (match) => attrsFromInner(match[1]),
      }),
    ];
  },
});

/** Parses `inner` of `[[inner]]` to node attrs, or false to leave it as text. */
function attrsFromInner(inner: string): WikiLinkAttrs | false {
  const target = parseWikiTarget(inner);
  if (!target) return false;
  return { title: target.title, heading: target.heading };
}
