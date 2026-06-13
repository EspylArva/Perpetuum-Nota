import {
  extractPlainText,
  extractReferencedUploadIds,
  extractSearchText,
  extractWikilinks,
  previewFromText,
  rewriteUploadSrcs,
} from './prosemirror-text';

const ASSET_A = '11111111-2222-3333-4444-555555555555';
const ASSET_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const doc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Title' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
      ],
    },
    { type: 'image', attrs: { src: `/api/uploads/${ASSET_A}`, width: 10 } },
    {
      type: 'paragraph',
      content: [{ type: 'image', attrs: { src: 'https://example.com/x.png' } }],
    },
    { type: 'image', attrs: { src: `/api/uploads/${ASSET_B}` } },
  ],
};

describe('extractPlainText / extractSearchText', () => {
  it('joins blocks with newlines and keeps full text in search mode', () => {
    const text = extractSearchText(doc);
    expect(text).toBe('Title\nHello world');
  });

  it('truncates with an ellipsis at the preview cap', () => {
    const long = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x'.repeat(500) }],
        },
      ],
    };
    const preview = extractPlainText(long);
    expect(preview.length).toBe(161); // 160 + ellipsis
    expect(preview.endsWith('…')).toBe(true);
  });

  it('previewFromText derives the same cap from stored text', () => {
    expect(previewFromText('short')).toBe('short');
    expect(previewFromText('y'.repeat(400)).length).toBe(161);
  });
});

describe('extractReferencedUploadIds', () => {
  it('collects only app-served upload ids', () => {
    const ids = extractReferencedUploadIds(doc);
    expect(ids).toEqual(new Set([ASSET_A, ASSET_B]));
  });

  it('returns empty for docs without images', () => {
    expect(extractReferencedUploadIds({ type: 'doc', content: [] }).size).toBe(
      0,
    );
  });
});

describe('extractWikilinks', () => {
  const para = (...texts: { text: string; marks?: unknown[] }[]) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: texts.map((t) => ({ type: 'text', ...t })),
      },
    ],
  });

  it('extracts inner titles, trimming whitespace', () => {
    expect(
      extractWikilinks(para({ text: 'see [[  Other Note  ]] here' })),
    ).toEqual(['Other Note']);
  });

  it('extracts multiple links across blocks in order', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'a [[Alpha]] b [[Beta]]' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'c [[Gamma]]' }] },
      ],
    };
    expect(extractWikilinks(doc)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('dedupes case-insensitively, keeping first-seen casing', () => {
    expect(
      extractWikilinks(
        para({ text: '[[Project]] then [[project]] and [[PROJECT]]' }),
      ),
    ).toEqual(['Project']);
  });

  it('ignores empty and whitespace-only links', () => {
    expect(extractWikilinks(para({ text: 'x [[]] y [[   ]] z' }))).toEqual([]);
  });

  it('does NOT match a link split across two text runs', () => {
    // `[[` lives in one run, `Title]]` in the next (e.g. different marks) — not detected.
    const doc = para(
      { text: 'start [[' },
      { text: 'Title]] end', marks: [{ type: 'bold' }] },
    );
    expect(extractWikilinks(doc)).toEqual([]);
  });

  it('handles nested/extra brackets without crossing an inner bracket', () => {
    // Inner part forbids brackets. `[[[Triple]]]` → the inner `[[` opens and the
    // bracket-free run `Triple` closes at the first `]]`, yielding 'Triple'.
    expect(extractWikilinks(para({ text: 'x [[[Triple]]] y' }))).toEqual([
      'Triple',
    ]);
    // A stray `[` inside breaks the pattern — `[[a [b]]` has no bracket-free
    // `[[...]]` span (the `[` aborts the inner match), so nothing is extracted.
    expect(extractWikilinks(para({ text: 'q [[a [b]] r' }))).toEqual([]);
  });

  it('returns empty for docs with no wikilinks', () => {
    expect(extractWikilinks(para({ text: 'plain text, no links' }))).toEqual(
      [],
    );
    expect(extractWikilinks({ type: 'doc', content: [] })).toEqual([]);
  });
});

describe('rewriteUploadSrcs', () => {
  it('remaps mapped ids, leaves others untouched, and does not mutate the source', () => {
    const map = new Map([[ASSET_A, 'fresh-id']]);
    const out = rewriteUploadSrcs(doc, map) as typeof doc;
    expect(out.content[2].attrs!['src']).toBe('/api/uploads/fresh-id');
    // unmapped upload + external url untouched
    expect(out.content[4].attrs!['src']).toBe(`/api/uploads/${ASSET_B}`);
    expect(out.content[3].content![0].attrs!['src']).toBe(
      'https://example.com/x.png',
    );
    // source untouched
    expect(doc.content[2].attrs!['src']).toBe(`/api/uploads/${ASSET_A}`);
  });
});
