import { describe, expect, it } from 'vitest';
import type { ProseMirrorDoc } from '@perpetuum-nota/shared';
import { migrateWikilinkText } from './wikilink-migrate';

const doc = (...inline: unknown[]): ProseMirrorDoc =>
  ({
    type: 'doc',
    content: [{ type: 'paragraph', content: inline as never }],
  }) as ProseMirrorDoc;

const para = (d: ProseMirrorDoc) => (d.content![0] as { content: unknown[] }).content;

describe('migrateWikilinkText', () => {
  it('converts a `[[Title]]` text run into a wikilink node, splitting surrounding text', () => {
    const out = migrateWikilinkText(doc({ type: 'text', text: 'see [[Other]] now' }));
    expect(para(out)).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'wikilink', attrs: { title: 'Other', heading: null } },
      { type: 'text', text: ' now' },
    ]);
  });

  it('parses a #heading into the node attrs', () => {
    const out = migrateWikilinkText(doc({ type: 'text', text: '[[Note#Section]]' }));
    expect(para(out)).toEqual([
      { type: 'wikilink', attrs: { title: 'Note', heading: 'Section' } },
    ]);
  });

  it('handles adjacent links with no separating text', () => {
    const out = migrateWikilinkText(doc({ type: 'text', text: '[[A]][[B]]' }));
    expect(para(out)).toEqual([
      { type: 'wikilink', attrs: { title: 'A', heading: null } },
      { type: 'wikilink', attrs: { title: 'B', heading: null } },
    ]);
  });

  it('preserves marks on the split-out text segments', () => {
    const out = migrateWikilinkText(
      doc({ type: 'text', text: 'a [[X]] b', marks: [{ type: 'bold' }] }),
    );
    expect(para(out)).toEqual([
      { type: 'text', text: 'a ', marks: [{ type: 'bold' }] },
      { type: 'wikilink', attrs: { title: 'X', heading: null } },
      { type: 'text', text: ' b', marks: [{ type: 'bold' }] },
    ]);
  });

  it('leaves an unparseable empty link as literal text', () => {
    const out = migrateWikilinkText(doc({ type: 'text', text: 'x [[]] y' }));
    expect(para(out)).toEqual([{ type: 'text', text: 'x [[]] y' }]);
  });

  it('leaves text without links untouched and recurses into nested blocks', () => {
    const nested: ProseMirrorDoc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'go [[Deep]]' }] },
              ],
            },
          ],
        },
      ],
    } as ProseMirrorDoc;
    const out = migrateWikilinkText(nested);
    const li = (out.content![0] as { content: { content: { content: unknown[] }[] }[] })
      .content[0].content[0].content;
    expect(li).toEqual([
      { type: 'text', text: 'go ' },
      { type: 'wikilink', attrs: { title: 'Deep', heading: null } },
    ]);
  });

  it('passes already-migrated wikilink nodes through unchanged', () => {
    const already = doc({ type: 'wikilink', attrs: { title: 'A', heading: null } });
    expect(migrateWikilinkText(already)).toEqual(already);
  });
});
