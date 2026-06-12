import type { Extensions } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { common, createLowlight } from 'lowlight';
import { FloatingImage } from './floating-image';
import { mathExtensions } from './math';
import { MarkdownLinkRule } from './markdown-link-rule';
import { ALLOWED_LINK_PROTOCOLS, isSafeLinkUrl } from './safe-url';

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
 */
export function buildExtensions(): Extensions {
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
    CodeBlockLowlight.configure({ lowlight }),
    TextStyle,
    Color,
    FontSize,
    ...mathExtensions(),
    MarkdownLinkRule,
    TaskList,
    TaskItem.configure({ nested: true }),
    FloatingImage.configure({ inline: false }),
  ];
}

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
