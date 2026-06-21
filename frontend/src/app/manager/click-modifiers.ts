/**
 * Decides whether a click on a note's title anchor should be handled IN-APP
 * (SPA open, preventing the browser default) or left to the browser so it can
 * open the `/note/:id` route in a new tab / window.
 *
 * Returns `true` only for a "plain" primary-button click: no modifier keys and
 * the main (left) button. Any of the following falls through to the browser's
 * native anchor handling and so returns `false`:
 *  - Ctrl / Cmd (meta) click → open in a new background tab
 *  - middle-click (button === 1) → open in a new tab
 *  - Shift click → open in a new window
 *  - Alt click → download / browser-specific behaviour
 *
 * Still used by the graph view and wikilink pills, where a modified click is
 * meant to hand off to the browser. Pure and framework-agnostic so it can be
 * unit-tested without a DOM.
 */
export function shouldOpenInApp(event: {
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): boolean {
  // Middle (or any non-primary) button → let the browser handle it.
  if (event.button != null && event.button !== 0) return false;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return false;
  }
  return true;
}

/**
 * For the in-app List-mode tab strip: decides whether a click that opens a note
 * should open it in a BACKGROUND tab (added to the strip without stealing focus)
 * rather than the foreground/active tab. Mirrors the browser's own new-tab
 * conventions, but stays in-app — the List rows no longer open an OS browser tab.
 *
 * Returns `true` (open in the background) for Ctrl / Cmd / Shift / Alt or a
 * middle-click; `false` (foreground, focus the new tab) for a plain primary
 * click. Pure and framework-agnostic.
 */
export function opensInBackground(event: {
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (event.button === 1) return true; // middle-click
  return !!(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey);
}
