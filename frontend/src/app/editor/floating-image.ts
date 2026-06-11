import { Editor, ResizableNodeView } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type {
  Decoration,
  DecorationSource,
  NodeView,
} from '@tiptap/pm/view';

/**
 * Image node with two additions over the stock TipTap Image:
 *  - `x`/`y` attributes that let an image float freely (absolute positioning)
 *    over the editor surface. They live in the node's attrs (the doc JSON), so
 *    they persist through the normal autosave — no extra API.
 *  - a custom node view that composes TipTap's `ResizableNodeView` (for resize
 *    handles, honoring stored width/height) with a pointer-drag that repositions
 *    the whole node and writes the new x/y back to the node attrs.
 *
 * Images start in-flow (x/y null, identical to before). The first drag turns an
 * image into a floating one.
 */

const RESIZE_HANDLE_CLASS = 'sn-resize-handle';

function readCoord(el: HTMLElement, attr: string): number | null {
  const raw = el.getAttribute(attr);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const FloatingImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      x: {
        default: null,
        parseHTML: (el: HTMLElement) => readCoord(el, 'data-x'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs['x'] == null ? {} : { 'data-x': attrs['x'] },
      },
      y: {
        default: null,
        parseHTML: (el: HTMLElement) => readCoord(el, 'data-y'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs['y'] == null ? {} : { 'data-y': attrs['y'] },
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node as ProseMirrorNode;

      const img = document.createElement('img');
      img.src = (node.attrs['src'] as string | undefined) ?? '';
      if (node.attrs['alt']) img.alt = node.attrs['alt'] as string;
      if (node.attrs['title']) img.title = node.attrs['title'] as string;
      img.draggable = false; // we handle dragging ourselves

      const resizable = new ResizableNodeView({
        element: img,
        node,
        editor: editor as Editor,
        getPos,
        onResize: (width, height) => {
          img.style.width = `${width}px`;
          img.style.height = `${height}px`;
        },
        onCommit: (width, height) => {
          const pos = getPos();
          if (pos == null) return;
          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              width,
              height,
            }),
          );
        },
        onUpdate: (updated) => updated.type === node.type,
        options: {
          directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
          min: { width: 60, height: 40 },
          className: { handle: RESIZE_HANDLE_CLASS },
        },
      });

      const container = resizable.dom;
      container.classList.add('floating-image');

      const place = (n: ProseMirrorNode): void => {
        const x = n.attrs['x'];
        const y = n.attrs['y'];
        if (typeof x === 'number' && typeof y === 'number') {
          container.style.position = 'absolute';
          container.style.left = `${x}px`;
          container.style.top = `${y}px`;
          container.style.zIndex = '2';
          container.setAttribute('data-floating', 'true');
        } else {
          container.style.position = '';
          container.style.left = '';
          container.style.top = '';
          container.style.zIndex = '';
          container.removeAttribute('data-floating');
        }
      };
      place(node);

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originX = 0;
      let originY = 0;

      const onPointerDown = (e: PointerEvent): void => {
        if (e.button !== 0) return;
        // Let the resize handles own their own interaction.
        if ((e.target as HTMLElement).closest(`.${RESIZE_HANDLE_CLASS}`)) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        originX = container.offsetLeft; // current position relative to .surface
        originY = container.offsetTop;
        container.style.position = 'absolute';
        container.style.left = `${originX}px`;
        container.style.top = `${originY}px`;
        try {
          container.setPointerCapture(e.pointerId);
        } catch {
          /* pointer capture unavailable; drag still tracks via listeners */
        }
        e.preventDefault();
      };
      const onPointerMove = (e: PointerEvent): void => {
        if (!dragging) return;
        container.style.left = `${originX + e.clientX - startX}px`;
        container.style.top = `${originY + e.clientY - startY}px`;
      };
      const onPointerUp = (e: PointerEvent): void => {
        if (!dragging) return;
        dragging = false;
        try {
          container.releasePointerCapture(e.pointerId);
        } catch {
          /* pointer already released */
        }
        const x = Math.max(0, Math.round(originX + e.clientX - startX));
        const y = Math.max(0, Math.round(originY + e.clientY - startY));
        const pos = getPos();
        if (pos == null) return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            x,
            y,
          }),
        );
      };

      container.addEventListener('pointerdown', onPointerDown);
      container.addEventListener('pointermove', onPointerMove);
      container.addEventListener('pointerup', onPointerUp);

      const view: NodeView = {
        dom: container,
        ignoreMutation: () => true,
        stopEvent: (event: Event) => dragging || event.type === 'dragstart',
        update: (
          updated: ProseMirrorNode,
          decorations: readonly Decoration[],
          innerDecorations: DecorationSource,
        ) => {
          if (updated.type !== node.type) return false;
          const ok = resizable.update(updated, decorations, innerDecorations);
          if (ok === false) return false;
          currentNode = updated;
          place(updated);
          return true;
        },
        destroy: () => {
          container.removeEventListener('pointerdown', onPointerDown);
          container.removeEventListener('pointermove', onPointerMove);
          container.removeEventListener('pointerup', onPointerUp);
          resizable.destroy();
        },
      };
      return view;
    };
  },
});
