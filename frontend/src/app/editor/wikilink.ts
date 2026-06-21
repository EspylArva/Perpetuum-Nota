import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { Suggestion } from '@tiptap/suggestion';
import { WIKILINK_NODE_NAME } from './wikilink-node';

/**
 * `[[` autocomplete for the note editor.
 *
 * Rendering and click-to-open live in the atomic {@link WikiLinkNode}; this
 * extension only drives the suggestion popup that appears when the user types
 * `[[`. Selecting an item inserts a `wikilink` NODE (replacing the whole
 * `[[query` the user typed), so the result is a single non-editable pill rather
 * than editable bracket text.
 */
export interface WikiLinkSuggestOptions {
  /** Autocomplete source: title matches for the current `[[query`. */
  suggest: (query: string) => { id: string; title: string }[];
}

/** Minimal inline-styled, keyboard-navigable autocomplete popup (no popup lib). */
interface SuggestItem {
  id: string;
  title: string;
}

interface PopupState {
  el: HTMLElement;
  items: SuggestItem[];
  /** Rendered item buttons, parallel to `items` — restyled in place on hover/arrow. */
  buttons: HTMLButtonElement[];
  selected: number;
  /**
   * Inserts the chosen item. Re-bound on every `onUpdate` so it always targets
   * the CURRENT suggestion range (`[[query`) — a stale closure would replace only
   * the original `[[` and leave the typed query behind.
   */
  command: (item: SuggestItem) => void;
}

function styleContainer(el: HTMLElement): void {
  Object.assign(el.style, {
    position: 'absolute',
    zIndex: '1000',
    minWidth: '180px',
    maxWidth: '320px',
    maxHeight: '240px',
    overflowY: 'auto',
    padding: '4px',
    background: 'var(--mat-sys-surface-container, #fff)',
    color: 'var(--mat-sys-on-surface, #000)',
    border: '1px solid var(--mat-sys-outline-variant, #ccc)',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
  } as Partial<CSSStyleDeclaration>);
}

function styleItem(btn: HTMLElement, isSelected: boolean): void {
  Object.assign(btn.style, {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    border: 'none',
    borderRadius: '4px',
    padding: '5px 8px',
    cursor: 'pointer',
    font: 'inherit',
    color: isSelected
      ? 'var(--mat-sys-on-secondary-container, #000)'
      : 'var(--mat-sys-on-surface, #000)',
    background: isSelected
      ? 'var(--mat-sys-secondary-container, #e0e0e0)'
      : 'transparent',
  } as Partial<CSSStyleDeclaration>);
}

/** Restyle existing buttons to reflect `state.selected` without rebuilding them. */
function highlightSelected(state: PopupState): void {
  state.buttons.forEach((btn, i) => styleItem(btn, i === state.selected));
}

/** Move the highlight to `index` (clamped) — used by hover and arrow keys. */
function setSelected(state: PopupState, index: number): void {
  if (index < 0 || index >= state.buttons.length) return;
  state.selected = index;
  highlightSelected(state);
}

function renderItems(state: PopupState): void {
  state.el.replaceChildren();
  state.buttons = [];
  if (state.items.length === 0) {
    const empty = document.createElement('div');
    Object.assign(empty.style, {
      padding: '6px 8px',
      opacity: '0.6',
    } as Partial<CSSStyleDeclaration>);
    empty.textContent = 'No matches';
    state.el.appendChild(empty);
    return;
  }
  if (state.selected >= state.items.length) state.selected = 0;
  state.items.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wikilink-suggest-item';
    btn.textContent = item.title;
    styleItem(btn, i === state.selected);
    btn.addEventListener('mousedown', (event) => {
      // mousedown (not click) + preventDefault so the editor keeps focus/selection
      // and the suggestion isn't dismissed before the command runs. Read
      // `state.command` at call time so we use the freshly-bound (current-range)
      // command, not whatever was current when this listener was attached.
      event.preventDefault();
      state.command(item);
    });
    // Only restyle on hover — rebuilding here would detach the button mid-click.
    btn.addEventListener('mouseenter', () => setSelected(state, i));
    state.buttons.push(btn);
    state.el.appendChild(btn);
  });
}

function positionPopup(
  el: HTMLElement,
  rect: DOMRect | null | undefined,
): void {
  if (!rect) return;
  el.style.left = `${rect.left + window.scrollX}px`;
  el.style.top = `${rect.bottom + window.scrollY + 4}px`;
}

export const WikiLink = Extension.create<WikiLinkSuggestOptions>({
  name: 'wikiLink',

  addOptions() {
    return {
      suggest: () => [],
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    const suggestionPlugin = Suggestion<SuggestItem>({
      editor: this.editor,
      char: '[[',
      startOfLine: false,
      allowSpaces: true,
      pluginKey: new PluginKey('wikilinkSuggest'),
      items: ({ query }) => options.suggest(query),
      command: ({ editor, range, props }) => {
        // Replace the whole `[[query` range with an atomic wikilink node, so the
        // typed query is consumed (not left trailing) and the result is a pill.
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from: range.from, to: range.to },
            { type: WIKILINK_NODE_NAME, attrs: { title: props.title, heading: null } },
          )
          .run();
      },
      render: () => {
        let popup: PopupState | null = null;

        return {
          onStart: (props) => {
            if (typeof document === 'undefined') return;
            const el = document.createElement('div');
            el.className = 'wikilink-suggest';
            styleContainer(el);
            popup = {
              el,
              items: props.items,
              buttons: [],
              selected: 0,
              command: (item) => props.command(item),
            };
            renderItems(popup);
            document.body.appendChild(el);
            positionPopup(el, props.clientRect?.());
          },

          onUpdate: (props) => {
            if (!popup) return;
            popup.items = props.items;
            // Re-bind to the current range so selecting an item replaces the whole
            // `[[query`, not just the original `[[`.
            popup.command = (item) => props.command(item);
            if (popup.selected >= popup.items.length) popup.selected = 0;
            renderItems(popup);
            positionPopup(popup.el, props.clientRect?.());
          },

          onKeyDown: (props) => {
            if (!popup) return false;
            const { event } = props;
            const count = popup.items.length;

            if (event.key === 'ArrowDown') {
              if (count > 0) setSelected(popup, (popup.selected + 1) % count);
              return true;
            }
            if (event.key === 'ArrowUp') {
              if (count > 0) {
                setSelected(popup, (popup.selected - 1 + count) % count);
              }
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              const item = popup.items[popup.selected];
              if (item) {
                popup.command(item);
                return true;
              }
              return false;
            }
            if (event.key === 'Escape') {
              return true;
            }
            return false;
          },

          onExit: () => {
            if (popup?.el.parentNode) popup.el.parentNode.removeChild(popup.el);
            popup = null;
          },
        };
      },
    });

    return [suggestionPlugin];
  },
});
