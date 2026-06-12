import { InputRule } from '@tiptap/core';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import type { Extensions } from '@tiptap/core';

/**
 * KaTeX math nodes with the delimiters this app standardises on:
 *   - `$x^2$`   → inline math
 *   - `$$x^2$$` → block math
 *
 * The stock @tiptap/extension-mathematics ships different triggers (`$$…$$`
 * inline, `$$$…$$$` block), so we reuse its node types / KaTeX node views /
 * commands but override `addInputRules` here. Block uses two `$`, inline a
 * single `$`, and the inline rule rejects `$$` so the two never collide.
 */

// $$…$$ filling a whole textblock → block math (a block node can't live inside
// a paragraph, so it must consume the line). Anchored to the line start.
export const BLOCK_MATH_INPUT = /^\$\$([^$\n]+?)\$\$$/;
// $…$ → inline math. A single `$` not adjacent to another `$` (so `$$…$$`
// is left for the block rule), no inner `$` or newline. The body must start
// and end with a non-space so prose between two currency amounts ("paid $20
// then $") is not swallowed as math — single-`$` delimiters make some
// ambiguity unavoidable; this keeps the common false positive out.
export const INLINE_MATH_INPUT = /(?<!\$)\$([^\s$](?:[^$\n]*[^\s$])?)\$$/;

const MathBlock = BlockMath.extend({
  addInputRules() {
    return [
      new InputRule({
        find: BLOCK_MATH_INPUT,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          if (!latex) return null;
          const { tr } = state;
          const $from = state.doc.resolve(range.from);
          const node = this.type.create({ latex });
          // Block math replaces its whole host textblock when the match spans
          // it; otherwise fall back to the matched range.
          const consumesHostTextblock =
            $from.depth > 0 &&
            $from.parent.isTextblock &&
            range.from === $from.start() &&
            range.to === $from.end();
          const canReplaceHostTextblock =
            consumesHostTextblock &&
            $from
              .node(-1)
              .canReplaceWith($from.index(-1), $from.indexAfter(-1), this.type);
          const replacementRange = canReplaceHostTextblock
            ? { from: $from.before(), to: $from.after() }
            : range;
          tr.replaceWith(replacementRange.from, replacementRange.to, node);
          return undefined;
        },
      }),
    ];
  },
});

const MathInline = InlineMath.extend({
  addInputRules() {
    return [
      new InputRule({
        find: INLINE_MATH_INPUT,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          if (!latex) return null;
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ latex }),
          );
          return undefined;
        },
      }),
    ];
  },
});

/** Configured math node set: block rule registered before inline so `$$` wins. */
export function mathExtensions(): Extensions {
  const katexOptions = { throwOnError: false };
  return [
    MathBlock.configure({ katexOptions }),
    MathInline.configure({ katexOptions }),
  ];
}
