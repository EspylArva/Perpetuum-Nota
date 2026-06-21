import { Editor, ResizableNodeView } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
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

// Pointer travel (px) before a press counts as a drag rather than a click. Below
// this, the press is treated as a plain click that selects the image node.
const DRAG_THRESHOLD = 4;

function readCoord(el: HTMLElement, attr: string): number | null {
  const raw = el.getAttribute(attr);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const FloatingImage = Image.extend({
  // The stock Image node sets `draggable: true`, which makes ProseMirror run its
  // native HTML5 node drag-and-drop: it relocates the node *within the text flow*
  // (fighting our pointer-based float), fires `pointercancel` instead of
  // `pointerup` mid-drag (leaving our drag state stuck), and records its own
  // history step (so undo "moves" the image back into the text). We do all
  // dragging via pointer events, so turn the native node DnD off.
  draggable: false,

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

      // A press starts as a candidate ("pressing"); it only becomes a real drag
      // once the pointer travels past DRAG_THRESHOLD. A press that never crosses
      // the threshold is a plain click, which selects the node so the user can
      // copy/cut/delete it via ProseMirror's built-in clipboard/keyboard handling.
      let pressing = false;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originX = 0;
      let originY = 0;

      const selectThisNode = (): void => {
        const pos = getPos();
        if (pos == null) return;
        const { state } = editor.view;
        editor.view.dispatch(
          state.tr.setSelection(NodeSelection.create(state.doc, pos)),
        );
        editor.view.focus();
      };

      const onPointerDown = (e: PointerEvent): void => {
        if (e.button !== 0) return;
        // Read-only viewers (shared notes) must not reposition images.
        if (!editor.isEditable) return;
        // Let the resize handles own their own interaction.
        if ((e.target as HTMLElement).closest(`.${RESIZE_HANDLE_CLASS}`)) return;
        pressing = true;
        dragging = false;
        startX = e.clientX;
        startY = e.clientY;
        originX = container.offsetLeft; // current position relative to .surface
        originY = container.offsetTop;
        try {
          container.setPointerCapture(e.pointerId);
        } catch {
          /* pointer capture unavailable; drag still tracks via listeners */
        }
      };
      const onPointerMove = (e: PointerEvent): void => {
        if (!pressing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
            return;
          }
          // Cross the threshold: promote the press to an actual drag.
          dragging = true;
          container.style.position = 'absolute';
          container.style.left = `${originX}px`;
          container.style.top = `${originY}px`;
        }
        container.style.left = `${originX + dx}px`;
        container.style.top = `${originY + dy}px`;
        e.preventDefault();
      };
      const onPointerUp = (e: PointerEvent): void => {
        if (!pressing) return;
        pressing = false;
        try {
          container.releasePointerCapture(e.pointerId);
        } catch {
          /* pointer already released */
        }
        if (!dragging) {
          // A plain click (no meaningful movement): select the image node so it
          // can be copied, cut, or deleted.
          selectThisNode();
          return;
        }
        dragging = false;
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
      // If the gesture is interrupted (e.g. the browser steals the pointer for a
      // native drag, or the window loses focus), reset state so the image doesn't
      // get stuck following the cursor and re-render from the committed attrs.
      const onPointerCancel = (): void => {
        if (!pressing) return;
        pressing = false;
        dragging = false;
        place(currentNode);
      };
      // Belt-and-suspenders: even with `draggable: false`, suppress any native
      // drag so it can never relocate the node or cancel our pointer gesture.
      const onDragStart = (e: DragEvent): void => e.preventDefault();

      container.addEventListener('pointerdown', onPointerDown);
      container.addEventListener('pointermove', onPointerMove);
      container.addEventListener('pointerup', onPointerUp);
      container.addEventListener('pointercancel', onPointerCancel);
      container.addEventListener('dragstart', onDragStart);

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
          container.removeEventListener('pointercancel', onPointerCancel);
          container.removeEventListener('dragstart', onDragStart);
          resizable.destroy();
        },
      };
      return view;
    };
  },
});
