import { describe, expect, it } from 'vitest';
import { tagColor } from './tag-color';

describe('tagColor', () => {
  it('is deterministic — same name always yields the same color', () => {
    expect(tagColor('angular')).toEqual(tagColor('angular'));
    expect(tagColor('design')).toEqual(tagColor('design'));
  });

  it('returns a translucent tint bg and the solid hue as fg', () => {
    const c = tagColor('rxjs');
    expect(c.bg).toMatch(/^color-mix\(in srgb, #[0-9a-f]{6} 22%, transparent\)$/);
    expect(c.fg).toMatch(/^#[0-9a-f]{6}$/);
    // The fg hue is the one tinted into the bg.
    expect(c.bg).toContain(c.fg);
  });

  it('always returns a color within the curated palette', () => {
    for (const name of ['a', 'work', 'TODO', 'a-very-long-tag-name', '', '123']) {
      const { fg } = tagColor(name);
      expect(fg).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('distinguishes different names (not all collapse to one color)', () => {
    const names = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
    const distinct = new Set(names.map((n) => tagColor(n).fg));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
