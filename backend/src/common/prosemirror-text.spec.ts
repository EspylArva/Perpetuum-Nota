import {
  extractPlainText,
  extractReferencedUploadIds,
  extractSearchText,
  previewFromText,
  rewriteUploadSrcs,
} from './prosemirror-text';

const ASSET_A = '11111111-2222-3333-4444-555555555555';
const ASSET_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
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
        { type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(500) }] },
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
    expect(extractReferencedUploadIds({ type: 'doc', content: [] }).size).toBe(0);
  });
});

describe('rewriteUploadSrcs', () => {
  it('remaps mapped ids, leaves others untouched, and does not mutate the source', () => {
    const map = new Map([[ASSET_A, 'fresh-id']]);
    const out = rewriteUploadSrcs(doc, map) as typeof doc;
    expect(out.content[2].attrs!['src']).toBe('/api/uploads/fresh-id');
    // unmapped upload + external url untouched
    expect(out.content[4].attrs!['src']).toBe(`/api/uploads/${ASSET_B}`);
    expect(out.content[3].content![0].attrs!['src']).toBe('https://example.com/x.png');
    // source untouched
    expect(doc.content[2].attrs!['src']).toBe(`/api/uploads/${ASSET_A}`);
  });
});
