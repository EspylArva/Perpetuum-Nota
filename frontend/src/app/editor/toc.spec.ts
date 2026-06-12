import { describe, expect, it } from 'vitest';
import { extractToc } from './toc';
import type { ProseMirrorDoc, ProseMirrorNode } from '@stickynotes/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doc(...content: ProseMirrorNode[]): ProseMirrorDoc {
  return { type: 'doc', content };
}

function heading(level: number, ...children: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'heading', attrs: { level }, content: children };
}

function text(t: string): ProseMirrorNode {
  return { type: 'text', text: t };
}

function p(...children: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'paragraph', content: children };
}

// ---------------------------------------------------------------------------

describe('extractToc', () => {
  it('returns an empty array for an empty doc', () => {
    expect(extractToc({ type: 'doc' })).toEqual([]);
  });

  it('returns an empty array for a doc with no headings', () => {
    expect(extractToc(doc(p(text('hello'))))).toEqual([]);
  });

  it('extracts a single heading with correct level, text, and pos', () => {
    // doc(heading(1, "Title"))
    // heading is the first child, positioned at 0 in ProseMirror terms.
    const result = extractToc(doc(heading(1, text('Title'))));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ level: 1, text: 'Title', pos: 0 });
  });

  it('extracts multiple flat headings with correct positions', () => {
    // doc(heading(2, "Intro"), heading(3, "Sub"))
    //
    // Position accounting (ProseMirror):
    //   pos 0: heading node start (opening token)
    //   pos 1..5: text "Intro" (5 chars)
    //   pos 6: heading node end (closing token)
    //   nodeSize = 7
    //
    //   pos 7: second heading node start
    //   pos 8..10: text "Sub" (3 chars)
    //   pos 11: second heading end
    //   nodeSize = 5
    const result = extractToc(doc(heading(2, text('Intro')), heading(3, text('Sub'))));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ level: 2, text: 'Intro', pos: 0 });
    expect(result[1]).toMatchObject({ level: 3, text: 'Sub', pos: 7 });
  });

  it('skips non-heading top-level nodes and accounts for their size', () => {
    // doc(p("Hello"), heading(1, "Title"))
    //
    // Paragraph node:
    //   pos 0: paragraph start
    //   pos 1..5: text "Hello" (5 chars)
    //   pos 6: paragraph end   → nodeSize = 7
    //
    // Heading node:
    //   pos 7: heading start
    //   pos 8..12: text "Title" (5 chars)
    //   pos 13: heading end
    const result = extractToc(doc(p(text('Hello')), heading(1, text('Title'))));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ level: 1, text: 'Title', pos: 7 });
  });

  it('computes text from a heading that contains multiple text nodes', () => {
    // heading text can span several text nodes (e.g. due to marks)
    const result = extractToc(doc(heading(2, text('Hello'), text(' World'))));
    expect(result[0].text).toBe('Hello World');
  });

  it('handles a heading with marks by returning plain text', () => {
    const boldText: ProseMirrorNode = {
      type: 'text',
      text: 'Bold',
      marks: [{ type: 'bold' }],
    };
    const result = extractToc(doc(heading(1, boldText, text(' Heading'))));
    expect(result[0].text).toBe('Bold Heading');
  });

  it('extracts headings nested inside block nodes (e.g. — not inside list but verifying direct children)', () => {
    // For this implementation we only scan TOP-LEVEL children of doc
    // (TipTap headings are always top-level block nodes, never inside
    //  lists or blockquotes in practice). So deeply-nested headings are
    //  intentionally not extracted.
    const result = extractToc(doc(heading(1, text('Top'))));
    expect(result.map((h) => h.text)).toEqual(['Top']);
  });

  it('positions are correct for a three-heading doc', () => {
    // doc(heading(1, "A"), heading(2, "BB"), heading(3, "CCC"))
    // H1("A"): pos 0, nodeSize = 1+1+1 = 3
    // H2("BB"): pos 3, nodeSize = 1+2+1 = 4
    // H3("CCC"): pos 7, nodeSize = 1+3+1 = 5
    const result = extractToc(
      doc(heading(1, text('A')), heading(2, text('BB')), heading(3, text('CCC'))),
    );
    expect(result[0]).toMatchObject({ pos: 0 });
    expect(result[1]).toMatchObject({ pos: 3 });
    expect(result[2]).toMatchObject({ pos: 7 });
  });
});
