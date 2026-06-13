import { describe, expect, it } from 'vitest';
import { shouldOpenInApp } from './click-modifiers';

describe('shouldOpenInApp', () => {
  it('plain left-click opens in-app', () => {
    expect(shouldOpenInApp({ button: 0 })).toBe(true);
    expect(shouldOpenInApp({})).toBe(true);
  });

  it('Ctrl+Click lets the browser handle it (new tab)', () => {
    expect(shouldOpenInApp({ button: 0, ctrlKey: true })).toBe(false);
  });

  it('Cmd/Meta+Click lets the browser handle it (new tab)', () => {
    expect(shouldOpenInApp({ button: 0, metaKey: true })).toBe(false);
  });

  it('Shift+Click lets the browser handle it (new window)', () => {
    expect(shouldOpenInApp({ button: 0, shiftKey: true })).toBe(false);
  });

  it('Alt+Click lets the browser handle it', () => {
    expect(shouldOpenInApp({ button: 0, altKey: true })).toBe(false);
  });

  it('middle-click (button 1) lets the browser handle it (new tab)', () => {
    expect(shouldOpenInApp({ button: 1 })).toBe(false);
  });

  it('right-click (button 2) is not an in-app open', () => {
    expect(shouldOpenInApp({ button: 2 })).toBe(false);
  });
});
