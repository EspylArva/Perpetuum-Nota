import type { Extensions } from '@tiptap/core';
import type { ProseMirrorDoc } from '@perpetuum-nota/shared';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { common, createLowlight } from 'lowlight';
import { createCodeBlockWithLanguage } from './code-block-language';
import { FloatingImage } from './floating-image';
import { ListIndentKeymap } from './list-indent';
import { mathExtensions } from './math';
import { MarkdownLinkRule } from './markdown-link-rule';
import { WikiLink } from './wikilink';
import { WikiLinkNode } from './wikilink-node';
import { ALLOWED_LINK_PROTOCOLS, isSafeLinkUrl } from './safe-url';

/**
 * Options for the `[[wikilink]]` feature, split across the two extensions that
 * back it: {@link WikiLinkNode} (renders the atomic pill, resolves clicks) and
 * {@link WikiLink} (drives the `[[` autocomplete).
 */
export interface WikiLinkOptions {
  /** Maps a `[[Title]]` to a note id (case-insensitive), or null if unknown. */
  resolve: (title: string) => string | null;
  /** Opens the target note, optionally scrolling to a `#heading` anchor. */
  navigate: (id: string, heading: string | null) => void;
  /** Autocomplete source: title matches for the current `[[query`. */
  suggest: (query: string) => { id: string; title: string }[];
}

/**
 * Shared editor extension set. StarterKit v3 bundles bold/italic/underline/
 * strike, ordered + unordered lists, headings, history, blockquote, code block,
 * and link — so links are configured here rather than added separately. Task
 * lists (checkboxes) come from @tiptap/extension-list, which StarterKit already
 * depends on.
 *
 * StarterKit's plain CodeBlock is disabled in favour of CodeBlockLowlight, which
 * adds offline syntax highlighting via lowlight's `common` grammar set (all
 * bundled — no network). TextStyle + Color + FontSize back the toolbar's colour
 * and size controls. mathExtensions() renders `$…$` (inline) / `$$…$$` (block)
 * with KaTeX offline. MarkdownLinkRule turns typed `[text](url)` into a
 * (scheme-checked) link.
 *
 * FloatingImage extends the stock Image node with a custom node view that makes
 * images both resizable (TipTap's ResizableNodeView) and free-floating: width,
 * height, and x/y all live in the node's attrs (the doc JSON), so they persist
 * through the normal autosave.
 *
 * WikiLinkNode renders `[[wikilinks]]` as atomic, non-editable inline pills
 * (stored as `wikilink` nodes in the doc; the backend understands them) and
 * resolves pill clicks to navigation; WikiLink drives the `[[` autocomplete. Both
 * are configured from the editor component's options; with no opts they are inert.
 */
export function buildExtensions(opts?: {
  wikilink?: WikiLinkOptions;
}): Extensions {
  const lowlight = createLowlight(common);
  return [
    StarterKit.configure({
      codeBlock: false,
      link: {
        autolink: true,
        linkOnPaste: true,
        openOnClick: true,
        protocols: [...ALLOWED_LINK_PROTOCOLS],
        // Block javascript:/data:/etc. hrefs from autolink, paste, and parsed HTML.
        isAllowedUri: (url, { defaultValidate }) =>
          isSafeLinkUrl(url) && defaultValidate(url),
        HTMLAttributes: { target: '_blank', rel: 'noopener nofollow' },
      },
    }),
    createCodeBlockWithLanguage(lowlight),
    // Tables: TableKit bundles Table/TableRow/TableHeader/TableCell. `resizable`
    // turns on draggable column borders (the .column-resize-handle styled in
    // note-editor.scss). Pasted/typed HTML tables parse via the schema, so no
    // input rule is needed — authoring is driven by the toolbar's Table menu.
    TableKit.configure({ table: { resizable: true } }),
    TextStyle,
    Color,
    FontSize,
    ...mathExtensions(),
    MarkdownLinkRule,
    TaskList,
    TaskItem.configure({ nested: true }),
    // Cross-kind Tab indentation (e.g. a checkbox can become a sub-item of a
    // bullet/ordered list). Higher priority than the stock list keymaps.
    ListIndentKeymap,
    FloatingImage.configure({ inline: false }),
    WikiLinkNode.configure({
      resolve: opts?.wikilink?.resolve ?? (() => null),
      navigate: opts?.wikilink?.navigate ?? (() => {}),
    }),
    WikiLink.configure({ suggest: opts?.wikilink?.suggest ?? (() => []) }),
  ];
}

export const EMPTY_DOC: ProseMirrorDoc = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};
