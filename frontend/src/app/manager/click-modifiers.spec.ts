import { describe, expect, it } from 'vitest';
import { opensInBackground, shouldOpenInApp } from './click-modifiers';

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

describe('opensInBackground', () => {
  it('plain left-click opens in the foreground (active) tab', () => {
    expect(opensInBackground({ button: 0 })).toBe(false);
    expect(opensInBackground({})).toBe(false);
  });

  it('Ctrl+Click opens a background tab', () => {
    expect(opensInBackground({ button: 0, ctrlKey: true })).toBe(true);
  });

  it('Cmd/Meta+Click opens a background tab', () => {
    expect(opensInBackground({ button: 0, metaKey: true })).toBe(true);
  });

  it('Shift+Click opens a background tab', () => {
    expect(opensInBackground({ button: 0, shiftKey: true })).toBe(true);
  });

  it('Alt+Click opens a background tab', () => {
    expect(opensInBackground({ button: 0, altKey: true })).toBe(true);
  });

  it('middle-click (button 1) opens a background tab', () => {
    expect(opensInBackground({ button: 1 })).toBe(true);
  });
});
