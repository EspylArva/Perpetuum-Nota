import { describe, expect, it } from 'vitest';
import { BLOCK_MATH_INPUT, INLINE_MATH_INPUT } from './math';

describe('math input-rule delimiters', () => {
  describe('inline ($…$)', () => {
    it('matches a single-dollar run and captures the latex', () => {
      const m = INLINE_MATH_INPUT.exec('the value $x^2$');
      expect(m?.[1]).toBe('x^2');
    });

    it('does not fire on a $$…$$ run (left to the block rule)', () => {
      expect(INLINE_MATH_INPUT.test('$$x^2$$')).toBe(false);
    });

    it('requires the closing $ at the end of input', () => {
      expect(INLINE_MATH_INPUT.test('$x^2$ more text')).toBe(false);
    });

    it('rejects an empty body', () => {
      expect(INLINE_MATH_INPUT.test('$$')).toBe(false);
    });

    it('matches a single-character body', () => {
      expect(INLINE_MATH_INPUT.exec('price is $n$')?.[1]).toBe('n');
    });

    it('does not swallow prose between currency amounts', () => {
      // "paid $20 then typed another $" — body would be "20 then typed another "
      expect(INLINE_MATH_INPUT.test('paid $20 then typed another $')).toBe(false);
      expect(INLINE_MATH_INPUT.test('items $5 and $6 cost $')).toBe(false);
    });

    it('rejects bodies with leading or trailing spaces', () => {
      expect(INLINE_MATH_INPUT.test('$ x^2$')).toBe(false);
      expect(INLINE_MATH_INPUT.test('$x^2 $')).toBe(false);
    });

    it('still matches multi-word latex with internal spaces', () => {
      expect(INLINE_MATH_INPUT.exec('$a + b$')?.[1]).toBe('a + b');
    });

    it('never treats a $ as the start of the body', () => {
      expect(INLINE_MATH_INPUT.test('x$$y$')).toBe(false);
    });
  });

  describe('block ($$…$$)', () => {
    it('matches a double-dollar run filling the line and captures the latex', () => {
      const m = BLOCK_MATH_INPUT.exec('$$\\frac{a}{b}$$');
      expect(m?.[1]).toBe('\\frac{a}{b}');
    });

    it('only matches a $$…$$ that starts the textblock', () => {
      expect(BLOCK_MATH_INPUT.test('text $$x^2$$')).toBe(false);
    });

    it('requires the closing $$ at the end of input', () => {
      expect(BLOCK_MATH_INPUT.test('$$x^2$$ trailing')).toBe(false);
    });

    it('rejects an empty body', () => {
      expect(BLOCK_MATH_INPUT.test('$$$$')).toBe(false);
    });
  });
});
