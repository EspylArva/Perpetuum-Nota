import {
  extractPlainText,
  extractReferencedUploadIds,
  extractSearchText,
  extractWikilinks,
  previewFromText,
  renameWikilinks,
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

  it('drops a #section anchor, keeping only the note title', () => {
    expect(extractWikilinks(para({ text: 'see [[Note#Heading]] here' }))).toEqual(
      ['Note'],
    );
  });

  it('collapses plain and #-anchored forms of the same note (dedup)', () => {
    expect(
      extractWikilinks(para({ text: '[[Note]] and [[Note#Section]]' })),
    ).toEqual(['Note']);
  });

  it('ignores anchor-only links with no title before the #', () => {
    expect(extractWikilinks(para({ text: 'go to [[#heading]] now' }))).toEqual(
      [],
    );
  });

  it('trims the title around a #, ignoring spaces near the anchor', () => {
    expect(
      extractWikilinks(para({ text: '[[ My Note # Some Heading ]]' })),
    ).toEqual(['My Note']);
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

describe('extractWikilinks (node form)', () => {
  const docWith = (...inline: unknown[]) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: inline }],
  });

  it('extracts titles from atomic wikilink nodes', () => {
    expect(
      extractWikilinks(
        docWith(
          { type: 'text', text: 'see ' },
          { type: 'wikilink', attrs: { title: 'Other Note', heading: null } },
        ),
      ),
    ).toEqual(['Other Note']);
  });

  it('drops a node anchor and dedupes node + legacy text forms', () => {
    expect(
      extractWikilinks(
        docWith(
          { type: 'wikilink', attrs: { title: 'Note', heading: 'Section' } },
          { type: 'text', text: ' and [[Note]] again' },
        ),
      ),
    ).toEqual(['Note']);
  });

  it('ignores nodes with an empty/whitespace title', () => {
    expect(
      extractWikilinks(
        docWith({ type: 'wikilink', attrs: { title: '   ', heading: null } }),
      ),
    ).toEqual([]);
  });

  it('includes node titles in extracted search text', () => {
    expect(
      extractSearchText(
        docWith(
          { type: 'text', text: 'Hello ' },
          { type: 'wikilink', attrs: { title: 'World', heading: null } },
        ),
      ),
    ).toBe('Hello World');
  });
});

describe('renameWikilinks', () => {
  interface Inline {
    text?: string;
    attrs?: { title: string; heading: string | null };
  }
  type Doc = { content: { content: Inline[] }[] };
  const docWith = (...inline: unknown[]) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: inline }],
  });
  const firstInline = (doc: unknown): Inline => (doc as Doc).content[0].content[0];

  it('rewrites a matching wikilink node title and reports changed', () => {
    const { doc, changed } = renameWikilinks(
      docWith({ type: 'wikilink', attrs: { title: 'Old', heading: null } }),
      'old',
      'New',
    );
    expect(changed).toBe(true);
    expect(firstInline(doc).attrs!.title).toBe('New');
  });

  it('preserves a node anchor when renaming', () => {
    const { doc } = renameWikilinks(
      docWith({ type: 'wikilink', attrs: { title: 'Old', heading: 'Sec' } }),
      'Old',
      'New',
    );
    expect(firstInline(doc).attrs).toEqual({ title: 'New', heading: 'Sec' });
  });

  it('rewrites legacy `[[Old]]` text, preserving a #anchor', () => {
    const { doc, changed } = renameWikilinks(
      docWith({ type: 'text', text: 'see [[Old#Heading]] and [[Old]] here' }),
      'old',
      'New Name',
    );
    expect(changed).toBe(true);
    expect(firstInline(doc).text).toBe(
      'see [[New Name#Heading]] and [[New Name]] here',
    );
  });

  it('leaves non-matching links untouched and reports no change', () => {
    const original = docWith(
      { type: 'wikilink', attrs: { title: 'Keep', heading: null } },
      { type: 'text', text: ' and [[Other]]' },
    );
    const { doc, changed } = renameWikilinks(original, 'Old', 'New');
    expect(changed).toBe(false);
    expect(doc).toEqual(original);
  });

  it('does not mutate the input document', () => {
    const original = docWith({
      type: 'wikilink',
      attrs: { title: 'Old', heading: null },
    });
    renameWikilinks(original, 'Old', 'New');
    expect(firstInline(original).attrs!.title).toBe('Old');
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
