import { Extension, InputRule } from '@tiptap/core';
import type { MarkType } from '@tiptap/pm/model';
import { isSafeLinkUrl } from './safe-url';

/**
 * Pure matcher for the markdown link input rule. Returns the link text and
 * href when the input ends in `[text](url)` and the url passes the scheme
 * allowlist, otherwise null. Kept separate from the TipTap wiring so the regex
 * and safety policy are unit-testable without a ProseMirror schema.
 *
 * The closing `)` must be the final character — the input rule fires on the
 * typed paren, so trailing text means the user isn't closing a link right now.
 */
export interface MarkdownLinkMatch {
  text: string;
  href: string;
}

// [text](url) — text is any run without []; url is any run without whitespace
// or a closing paren. Anchored to the end so only a freshly-closed link matches.
const MARKDOWN_LINK = /\[([^\][]+)\]\(([^\s)]+)\)$/;

export function matchMarkdownLink(input: string): MarkdownLinkMatch | null {
  const match = MARKDOWN_LINK.exec(input);
  if (!match) return null;
  const [, text, href] = match;
  if (!text || !href) return null;
  if (!isSafeLinkUrl(href)) return null;
  return { text, href };
}

/**
 * TipTap extension adding the `[text](url)` → link input rule. Builds a custom
 * InputRule (rather than markInputRule) because the displayed text must become
 * just `text` with the link mark — the brackets and url are dropped. Unsafe
 * schemes never match, so they stay plain text.
 */
export const MarkdownLinkRule = Extension.create({
  name: 'markdownLinkRule',

  addInputRules() {
    const linkType = this.editor.schema.marks['link'] as MarkType | undefined;
    if (!linkType) return [];

    return [
      new InputRule({
        find: (text) => {
          const result = matchMarkdownLink(text);
          if (!result) return null;
          const match = MARKDOWN_LINK.exec(text)!;
          return {
            index: match.index,
            text: match[0],
            replaceWith: result.text,
            data: result,
          };
        },
        handler: ({ state, range, match, chain }) => {
          const result = match['data'] as MarkdownLinkMatch | undefined;
          if (!result) return null;
          // Don't auto-link inside code blocks / inline code.
          const { from } = state.selection;
          const $pos = state.doc.resolve(Math.max(0, from - 1));
          if ($pos.parent.type.spec.code) return null;

          chain()
            .deleteRange(range)
            .insertContent({
              type: 'text',
              text: result.text,
              marks: [{ type: 'link', attrs: { href: result.href } }],
            })
            // Stop the link mark from bleeding into text typed afterwards.
            .unsetMark('link')
            .run();
          return undefined;
        },
      }),
    ];
  },
});
