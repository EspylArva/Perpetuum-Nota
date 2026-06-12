import { describe, expect, it } from 'vitest';
import { docToMarkdown } from './markdown-export';
import type { ProseMirrorDoc, ProseMirrorNode } from '@stickynotes/shared';

// ---------------------------------------------------------------------------
// Helpers to build minimal doc fixtures without verbose repetition.
// ---------------------------------------------------------------------------

function doc(...content: ProseMirrorNode[]): ProseMirrorDoc {
  return { type: 'doc', content };
}

function p(...children: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'paragraph', content: children };
}

function text(t: string, ...marks: Array<{ type: string; attrs?: Record<string, unknown> }>): ProseMirrorNode {
  return marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t };
}

function heading(level: number, ...children: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'heading', attrs: { level }, content: children };
}

function codeBlock(language: string, code: string): ProseMirrorNode {
  return { type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text: code }] };
}

function blockquote(...children: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'blockquote', content: children };
}

function bulletList(...items: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'bulletList', content: items };
}

function orderedList(...items: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'orderedList', content: items };
}

function listItem(...children: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'listItem', content: children };
}

function taskList(...items: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'taskList', content: items };
}

function taskItem(checked: boolean, ...children: ProseMirrorNode[]): ProseMirrorNode {
  return { type: 'taskItem', attrs: { checked }, content: children };
}

function image(src: string): ProseMirrorNode {
  return { type: 'image', attrs: { src } };
}

function hardBreak(): ProseMirrorNode {
  return { type: 'hardBreak' };
}

function horizontalRule(): ProseMirrorNode {
  return { type: 'horizontalRule' };
}

function inlineMath(latex: string): ProseMirrorNode {
  return { type: 'inlineMath', attrs: { latex } };
}

function blockMath(latex: string): ProseMirrorNode {
  return { type: 'blockMath', attrs: { latex } };
}

// ---------------------------------------------------------------------------

describe('docToMarkdown', () => {
  describe('empty doc', () => {
    it('returns empty string for a doc with no content', () => {
      expect(docToMarkdown({ type: 'doc' })).toBe('');
    });

    it('returns empty string for a doc with only an empty paragraph', () => {
      expect(docToMarkdown(doc(p()))).toBe('');
    });
  });

  describe('paragraph', () => {
    it('renders plain text paragraphs', () => {
      expect(docToMarkdown(doc(p(text('Hello world'))))).toBe('Hello world');
    });

    it('separates paragraphs with a blank line', () => {
      expect(docToMarkdown(doc(p(text('First')), p(text('Second'))))).toBe('First\n\nSecond');
    });
  });

  describe('headings', () => {
    it('renders heading level 1 with a single #', () => {
      expect(docToMarkdown(doc(heading(1, text('Title'))))).toBe('# Title');
    });

    it('renders heading level 2 with ##', () => {
      expect(docToMarkdown(doc(heading(2, text('Sub'))))).toBe('## Sub');
    });

    it('renders heading levels 3–6', () => {
      expect(docToMarkdown(doc(heading(3, text('H3'))))).toBe('### H3');
      expect(docToMarkdown(doc(heading(4, text('H4'))))).toBe('#### H4');
      expect(docToMarkdown(doc(heading(5, text('H5'))))).toBe('##### H5');
      expect(docToMarkdown(doc(heading(6, text('H6'))))).toBe('###### H6');
    });

    it('separates a heading and a paragraph with a blank line', () => {
      expect(docToMarkdown(doc(heading(1, text('Title')), p(text('Body'))))).toBe('# Title\n\nBody');
    });
  });

  describe('marks', () => {
    it('wraps bold text in **', () => {
      expect(docToMarkdown(doc(p(text('hi', { type: 'bold' }))))).toBe('**hi**');
    });

    it('wraps italic text in *', () => {
      expect(docToMarkdown(doc(p(text('hi', { type: 'italic' }))))).toBe('*hi*');
    });

    it('wraps strikethrough in ~~', () => {
      expect(docToMarkdown(doc(p(text('hi', { type: 'strike' }))))).toBe('~~hi~~');
    });

    it('wraps inline code in backticks', () => {
      expect(docToMarkdown(doc(p(text('fn()', { type: 'code' }))))).toBe('`fn()`');
    });

    it('wraps underline in <u> tags', () => {
      expect(docToMarkdown(doc(p(text('hi', { type: 'underline' }))))).toBe('<u>hi</u>');
    });

    it('renders a link as [text](href)', () => {
      expect(docToMarkdown(doc(p(text('click', { type: 'link', attrs: { href: 'https://example.com' } }))))).toBe('[click](https://example.com)');
    });

    it('drops textStyle mark silently and keeps the text', () => {
      expect(docToMarkdown(doc(p(text('colored', { type: 'textStyle', attrs: { color: '#ff0000' } }))))).toBe('colored');
    });

    it('stacks multiple marks: bold + italic', () => {
      const result = docToMarkdown(doc(p(text('hi', { type: 'bold' }, { type: 'italic' }))));
      // Both wrappers must be present; exact nesting order is an impl detail.
      expect(result).toContain('hi');
      expect(result).toContain('**');
      expect(result).toContain('*');
    });
  });

  describe('codeBlock', () => {
    it('renders a fenced code block with language', () => {
      expect(docToMarkdown(doc(codeBlock('typescript', 'const x = 1;')))).toBe(
        '```typescript\nconst x = 1;\n```',
      );
    });

    it('renders a code block without language as a plain fence', () => {
      expect(docToMarkdown(doc(codeBlock('', 'hello')))).toBe('```\nhello\n```');
    });
  });

  describe('blockquote', () => {
    it('prefixes each line with "> "', () => {
      expect(docToMarkdown(doc(blockquote(p(text('quoted')))))).toBe('> quoted');
    });

    it('handles a multi-line quote', () => {
      expect(
        docToMarkdown(doc(blockquote(p(text('line one')), p(text('line two'))))),
      ).toBe('> line one\n>\n> line two');
    });

    it('renders nested blockquotes', () => {
      expect(
        docToMarkdown(doc(blockquote(blockquote(p(text('deep')))))),
      ).toBe('> > deep');
    });
  });

  describe('lists', () => {
    it('renders a simple bullet list', () => {
      expect(
        docToMarkdown(doc(bulletList(listItem(p(text('a'))), listItem(p(text('b')))))),
      ).toBe('- a\n- b');
    });

    it('renders a simple ordered list with sequential numbers', () => {
      expect(
        docToMarkdown(doc(orderedList(listItem(p(text('first'))), listItem(p(text('second')))))),
      ).toBe('1. first\n2. second');
    });

    it('renders a nested bullet list indented by 2 spaces', () => {
      const nested = bulletList(
        listItem(p(text('outer')), bulletList(listItem(p(text('inner'))))),
      );
      expect(docToMarkdown(doc(nested))).toBe('- outer\n  - inner');
    });

    it('renders a nested ordered list indented by 2 spaces', () => {
      const nested = orderedList(
        listItem(p(text('a')), orderedList(listItem(p(text('a1'))), listItem(p(text('a2'))))),
        listItem(p(text('b'))),
      );
      expect(docToMarkdown(doc(nested))).toBe('1. a\n  1. a1\n  2. a2\n2. b');
    });
  });

  describe('taskList', () => {
    it('renders unchecked task items with - [ ]', () => {
      expect(
        docToMarkdown(doc(taskList(taskItem(false, p(text('todo')))))),
      ).toBe('- [ ] todo');
    });

    it('renders checked task items with - [x]', () => {
      expect(
        docToMarkdown(doc(taskList(taskItem(true, p(text('done')))))),
      ).toBe('- [x] done');
    });

    it('renders mixed task list', () => {
      expect(
        docToMarkdown(doc(taskList(taskItem(false, p(text('a'))), taskItem(true, p(text('b')))))),
      ).toBe('- [ ] a\n- [x] b');
    });
  });

  describe('image', () => {
    it('renders as ![](src)', () => {
      expect(docToMarkdown(doc(p(image('/api/uploads/abc123'))))).toBe('![](/api/uploads/abc123)');
    });
  });

  describe('hardBreak', () => {
    it('renders as two trailing spaces + newline', () => {
      const result = docToMarkdown(doc(p(text('line1'), hardBreak(), text('line2'))));
      expect(result).toBe('line1  \nline2');
    });
  });

  describe('horizontalRule', () => {
    it('renders as ---', () => {
      expect(docToMarkdown(doc(horizontalRule()))).toBe('---');
    });
  });

  describe('math nodes', () => {
    it('renders inlineMath as $latex$', () => {
      expect(docToMarkdown(doc(p(inlineMath('x^2'))))).toBe('$x^2$');
    });

    it('renders blockMath on its own lines as $$latex$$', () => {
      expect(docToMarkdown(doc(blockMath('\\frac{a}{b}')))).toBe('$$\\frac{a}{b}$$');
    });
  });

  describe('unknown node fallback', () => {
    it('renders text content of an unknown node rather than throwing', () => {
      const unknown: ProseMirrorNode = {
        type: 'unknownFutureNode',
        content: [{ type: 'text', text: 'fallback text' }],
      };
      expect(() => docToMarkdown(doc(unknown))).not.toThrow();
      expect(docToMarkdown(doc(unknown))).toContain('fallback text');
    });
  });

  describe('kitchen-sink document', () => {
    it('renders a doc mixing all supported nodes correctly', () => {
      const kitchenSink = doc(
        heading(1, text('My Note')),
        p(text('Normal paragraph with '), text('bold', { type: 'bold' }), text(' and '), text('italic', { type: 'italic' }), text('.')),
        codeBlock('python', 'print("hello")'),
        blockquote(p(text('A quote'))),
        bulletList(listItem(p(text('Item A'))), listItem(p(text('Item B')))),
        orderedList(listItem(p(text('Step 1'))), listItem(p(text('Step 2')))),
        taskList(taskItem(false, p(text('Todo'))), taskItem(true, p(text('Done')))),
        p(inlineMath('E=mc^2')),
        blockMath('\\int_0^1 x\\,dx'),
        horizontalRule(),
        p(image('/api/uploads/img1')),
        p(text('End')),
      );

      const md = docToMarkdown(kitchenSink);

      expect(md).toContain('# My Note');
      expect(md).toContain('**bold**');
      expect(md).toContain('*italic*');
      expect(md).toContain('```python\nprint("hello")\n```');
      expect(md).toContain('> A quote');
      expect(md).toContain('- Item A');
      expect(md).toContain('- Item B');
      expect(md).toContain('1. Step 1');
      expect(md).toContain('2. Step 2');
      expect(md).toContain('- [ ] Todo');
      expect(md).toContain('- [x] Done');
      expect(md).toContain('$E=mc^2$');
      expect(md).toContain('$$\\int_0^1 x\\,dx$$');
      expect(md).toContain('---');
      expect(md).toContain('![](/api/uploads/img1)');
      expect(md).toContain('End');
    });
  });
});
