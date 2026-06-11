import type { Extensions } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { FloatingImage } from './floating-image';
import { ALLOWED_LINK_PROTOCOLS, isSafeLinkUrl } from './safe-url';

/**
 * Shared editor extension set. StarterKit v3 bundles bold/italic/underline/
 * strike, ordered + unordered lists, headings, history, and link — so links are
 * configured here rather than added separately. Task lists (checkboxes) come
 * from @tiptap/extension-list, which StarterKit already depends on.
 *
 * FloatingImage extends the stock Image node with a custom node view that makes
 * images both resizable (TipTap's ResizableNodeView) and free-floating: width,
 * height, and x/y all live in the node's attrs (the doc JSON), so they persist
 * through the normal autosave.
 */
export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({
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
    TaskList,
    TaskItem.configure({ nested: true }),
    FloatingImage.configure({ inline: false }),
  ];
}

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
