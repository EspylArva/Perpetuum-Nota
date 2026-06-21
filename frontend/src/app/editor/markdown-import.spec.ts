import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, markdownToProseMirror } from './markdown-import';
import type { ProseMirrorNode } from '@perpetuum-nota/shared';

function blocks(md: string): ProseMirrorNode[] {
  return markdownToProseMirror(md).content ?? [];
}

describe('markdownToProseMirror', () => {
  it('parses ATX headings at the right level', () => {
    const [h1, h2] = blocks('# Title\n\n## Sub');
    expect(h1).toEqual({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Title' }],
    });
    expect(h2.attrs).toEqual({ level: 2 });
  });

  it('parses a bullet list', () => {
    const [list] = blocks('- one\n- two');
    expect(list.type).toBe('bulletList');
    expect(list.content).toHaveLength(2);
    expect(list.content![0]).toEqual({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
    });
  });

  it('parses an ordered list', () => {
    const [list] = blocks('1. first\n2. second');
    expect(list.type).toBe('orderedList');
    expect(list.content).toHaveLength(2);
  });

  it('parses task list checkboxes with checked state', () => {
    const [list] = blocks('- [ ] todo\n- [x] done');
    expect(list.type).toBe('taskList');
    expect(list.content![0]).toMatchObject({ type: 'taskItem', attrs: { checked: false } });
    expect(list.content![1]).toMatchObject({ type: 'taskItem', attrs: { checked: true } });
  });

  it('nests a deeper-indented list under its parent item', () => {
    const [list] = blocks('- parent\n  - child');
    const parentItem = list.content![0];
    expect(parentItem.content).toHaveLength(2);
    expect(parentItem.content![1].type).toBe('bulletList');
  });

  it('parses a fenced code block with a language', () => {
    const [code] = blocks('```ts\nconst x = 1;\n```');
    expect(code).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    });
  });

  it('parses a blockquote with inner formatting', () => {
    const [quote] = blocks('> hello **world**');
    expect(quote.type).toBe('blockquote');
    expect(quote.content![0].type).toBe('paragraph');
  });

  it('parses inline marks: bold, italic, code, strike, link', () => {
    const [para] = blocks('a **b** c *d* `e` ~~f~~ [g](http://x)');
    const texts = para.content!;
    expect(texts.find((t) => t.text === 'b')!.marks).toEqual([{ type: 'bold' }]);
    expect(texts.find((t) => t.text === 'd')!.marks).toEqual([{ type: 'italic' }]);
    expect(texts.find((t) => t.text === 'e')!.marks).toEqual([{ type: 'code' }]);
    expect(texts.find((t) => t.text === 'f')!.marks).toEqual([{ type: 'strike' }]);
    expect(texts.find((t) => t.text === 'g')!.marks).toEqual([
      { type: 'link', attrs: { href: 'http://x' } },
    ]);
  });

  it('handles nested emphasis inside bold', () => {
    const [para] = blocks('**bold _italic_**');
    const italic = para.content!.find((t) => t.text === 'italic')!;
    expect(italic.marks).toEqual([{ type: 'bold' }, { type: 'italic' }]);
  });

  it('parses a horizontal rule', () => {
    const [hr] = blocks('---');
    expect(hr).toEqual({ type: 'horizontalRule' });
  });

  it('falls back to a paragraph for plain text', () => {
    const [para] = blocks('just some words');
    expect(para).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'just some words' }],
    });
  });

  it('never yields an empty doc', () => {
    expect(markdownToProseMirror('')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });
});

describe('looksLikeMarkdown', () => {
  it('detects structural markers', () => {
    expect(looksLikeMarkdown('# heading')).toBe(true);
    expect(looksLikeMarkdown('- a list')).toBe(true);
    expect(looksLikeMarkdown('- [ ] task')).toBe(true);
    expect(looksLikeMarkdown('> quote')).toBe(true);
    expect(looksLikeMarkdown('```\ncode\n```')).toBe(true);
    expect(looksLikeMarkdown('some **bold** text')).toBe(true);
    expect(looksLikeMarkdown('a [link](http://x)')).toBe(true);
  });

  it('ignores ordinary prose', () => {
    expect(looksLikeMarkdown('just a normal sentence, nothing special.')).toBe(false);
    expect(looksLikeMarkdown('multiplication a * b and c * d')).toBe(false);
  });
});
