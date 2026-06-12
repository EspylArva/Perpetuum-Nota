import { describe, expect, it } from 'vitest';
import { postProcessHtmlForExport } from './export-postprocess';

describe('postProcessHtmlForExport', () => {
  describe('block math', () => {
    it('replaces a block-math div (with nested KaTeX divs) with a <p>$$…$$</p>', () => {
      const input =
        '<p>Before</p>' +
        '<div data-type="block-math" data-latex="\\frac{a}{b}">' +
        '<div class="katex"><span class="katex-html"><span>a</span><span>b</span></span></div>' +
        '</div>' +
        '<p>After</p>';

      const result = postProcessHtmlForExport(input);

      expect(result).toContain('$$\\frac{a}{b}$$');
      // No katex markup left
      expect(result).not.toContain('katex-html');
      expect(result).not.toContain('class="katex"');
      // Surrounding content intact
      expect(result).toContain('<p>Before</p>');
      expect(result).toContain('<p>After</p>');
      // No stray unmatched closing divs from the inner KaTeX structure
      const openDivs = (result.match(/<div/g) ?? []).length;
      const closeDivs = (result.match(/<\/div>/g) ?? []).length;
      expect(openDivs).toBe(closeDivs);
    });

    it('handles attribute order variant (data-latex before data-type)', () => {
      const input =
        '<div data-latex="x^2" data-type="block-math">' +
        '<div class="katex"><span>x2</span></div>' +
        '</div>';

      const result = postProcessHtmlForExport(input);
      expect(result).toContain('$$x^2$$');
      expect(result).not.toContain('katex');
    });

    it('replaces multiple block-math nodes independently', () => {
      const input =
        '<div data-type="block-math" data-latex="a+b"><div class="k">…</div></div>' +
        '<div data-type="block-math" data-latex="c-d"><div class="k">…</div></div>';

      const result = postProcessHtmlForExport(input);
      expect(result).toContain('$$a+b$$');
      expect(result).toContain('$$c-d$$');
    });
  });

  describe('inline math', () => {
    it('replaces an inline-math span with $…$', () => {
      const input =
        '<p>Area is ' +
        '<span data-type="inline-math" data-latex="\\pi r^2"><span class="katex">…</span></span>' +
        ' square units.</p>';

      const result = postProcessHtmlForExport(input);
      expect(result).toContain('$\\pi r^2$');
      expect(result).not.toContain('class="katex"');
      expect(result).toContain('Area is');
      expect(result).toContain('square units.');
    });

    it('handles multiple inline math nodes in the same paragraph', () => {
      const input =
        '<p>' +
        '<span data-type="inline-math" data-latex="a">…</span>' +
        ' and ' +
        '<span data-type="inline-math" data-latex="b">…</span>' +
        '</p>';

      const result = postProcessHtmlForExport(input);
      expect(result).toContain('$a$');
      expect(result).toContain('$b$');
    });
  });

  describe('mixed content', () => {
    it('handles a document with both block and inline math and leaves other markup alone', () => {
      const input =
        '<h1>Title</h1>' +
        '<p>Inline: <span data-type="inline-math" data-latex="E=mc^2"><span class="katex">…</span></span>.</p>' +
        '<div data-type="block-math" data-latex="\\int_0^1 x\\,dx">' +
        '<div class="katex-display"><div class="katex">…</div></div>' +
        '</div>' +
        '<p>End.</p>';

      const result = postProcessHtmlForExport(input);
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('$E=mc^2$');
      expect(result).toContain('$$\\int_0^1 x\\,dx$$');
      expect(result).toContain('<p>End.</p>');
      expect(result).not.toContain('katex');
    });
  });

  describe('no math', () => {
    it('passes through HTML with no math nodes unchanged (modulo serialisation)', () => {
      const input = '<p>Hello <strong>world</strong>.</p><ul><li>item</li></ul>';
      const result = postProcessHtmlForExport(input);
      // DOMParser/innerHTML round-trip may normalise quotes/casing but content intact
      expect(result).toContain('Hello');
      expect(result).toContain('world');
      expect(result).toContain('item');
      expect(result).not.toContain('$$');
      expect(result).not.toContain('$');
    });

    it('returns empty string for empty input', () => {
      expect(postProcessHtmlForExport('')).toBe('');
    });
  });
});
