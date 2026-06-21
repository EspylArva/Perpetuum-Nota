import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import type { createLowlight } from 'lowlight';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * A CodeBlockLowlight variant that makes fenced code blocks editable after
 * creation: each block renders a custom node view with an inline language
 * `<select>` so the syntax-highlight language can be changed at any time.
 *
 * CodeBlockLowlight stores the language in `node.attrs.language` and applies
 * highlighting through a ProseMirror decoration plugin (not a node view), so a
 * custom node view here is fully compatible — changing the `language` attr
 * re-runs the decoration-based highlighting automatically.
 *
 * The grammar list comes from the live lowlight instance
 * (`lowlight.listLanguages()`), so the picker only ever offers languages that
 * are actually registered and can highlight.
 */
export function createCodeBlockWithLanguage(
  lowlight: ReturnType<typeof createLowlight>,
) {
  // Registered grammar names, copied + sorted (listLanguages may return a live
  // reference; slice() guards against mutating lowlight's internal list).
  const languages = lowlight.listLanguages().slice().sort();

  return CodeBlockLowlight.extend({
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let currentNode = node as ProseMirrorNode;

        // Wrapper: position:relative anchor (via CSS) for the absolute select.
        const dom = document.createElement('div');
        dom.classList.add('code-block');

        // contenteditable="false" so ProseMirror ignores the picker entirely
        // (it's chrome, not document content).
        const select = document.createElement('select');
        select.classList.add('code-lang');
        select.setAttribute('contenteditable', 'false');

        // First option = plain text (no grammar) -> language attr cleared.
        const plain = document.createElement('option');
        plain.value = '';
        plain.textContent = 'Plain text';
        select.appendChild(plain);

        for (const name of languages) {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          select.appendChild(option);
        }

        select.value = (currentNode.attrs['language'] as string | null) || '';

        // pre > code is the highlight target; contentDOM = code so ProseMirror
        // fills it with the code text + highlight decorations.
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        pre.appendChild(code);

        dom.appendChild(select);
        dom.appendChild(pre);

        select.addEventListener('change', () => {
          if (typeof getPos !== 'function') return;
          const pos = getPos();
          if (pos == null) return;
          // Empty value -> null language (plain text). Setting the attr re-runs
          // CodeBlockLowlight's decoration highlighting.
          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              language: select.value || null,
            }),
          );
          editor.view.focus();
        });

        return {
          dom,
          contentDOM: code,
          update: (updatedNode: ProseMirrorNode) => {
            if (updatedNode.type !== currentNode.type) return false;
            currentNode = updatedNode;
            // Keep the picker in sync if the language attr changed elsewhere
            // (undo/redo, collaborative edits, markdown import, etc.).
            select.value =
              (updatedNode.attrs['language'] as string | null) || '';
            return true;
          },
          ignoreMutation: (mutation: MutationRecord | { type: 'selection' }) => {
            // Let ProseMirror handle selection changes normally.
            if (mutation.type === 'selection') return false;
            const target = (mutation as MutationRecord).target;
            // Ignore mutations from the select/header chrome (outside
            // contentDOM); let mutations inside the code through to PM.
            return !code.contains(target) && target !== code;
          },
        };
      };
    },
  }).configure({ lowlight });
}
