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
 * Pure and framework-agnostic so it can be unit-tested without a DOM.
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
