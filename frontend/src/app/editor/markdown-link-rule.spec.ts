import { describe, expect, it } from 'vitest';
import { matchMarkdownLink } from './markdown-link-rule';

describe('matchMarkdownLink', () => {
  it('matches a basic [text](url) at the end of the input', () => {
    const m = matchMarkdownLink('see [Example](https://example.com)');
    expect(m).not.toBeNull();
    expect(m!.text).toBe('Example');
    expect(m!.href).toBe('https://example.com');
  });

  it('accepts http and https URLs', () => {
    expect(matchMarkdownLink('[a](http://example.com)')?.href).toBe(
      'http://example.com',
    );
    expect(matchMarkdownLink('[a](https://example.com/p?q=1)')?.href).toBe(
      'https://example.com/p?q=1',
    );
  });

  it('accepts mailto URLs', () => {
    expect(matchMarkdownLink('[mail](mailto:a@b.com)')?.href).toBe(
      'mailto:a@b.com',
    );
  });

  it('rejects javascript: URLs (stays plain text)', () => {
    expect(matchMarkdownLink('[x](javascript:alert(1))')).toBeNull();
    expect(matchMarkdownLink('[x](JavaScript:alert(1))')).toBeNull();
  });

  it('rejects data: URLs', () => {
    expect(matchMarkdownLink('[x](data:text/html,<script>)')).toBeNull();
  });

  it('rejects other dangerous schemes', () => {
    expect(matchMarkdownLink('[x](vbscript:msgbox(1))')).toBeNull();
    expect(matchMarkdownLink('[x](file:///etc/passwd)')).toBeNull();
  });

  it('accepts relative and bare-domain URLs (mirrors safe-url policy)', () => {
    expect(matchMarkdownLink('[home](/notes/1)')?.href).toBe('/notes/1');
    expect(matchMarkdownLink('[rel](example.com)')?.href).toBe('example.com');
  });

  it('supports titles with spaces', () => {
    const m = matchMarkdownLink('[My Cool Link](https://example.com)');
    expect(m?.text).toBe('My Cool Link');
    expect(m?.href).toBe('https://example.com');
  });

  it('only matches when the closing paren is the final character', () => {
    // The input rule fires on the typed ")" — text after it must not match.
    expect(matchMarkdownLink('[a](https://example.com) trailing')).toBeNull();
  });

  it('requires a non-empty title', () => {
    expect(matchMarkdownLink('[](https://example.com)')).toBeNull();
  });

  it('requires a non-empty url', () => {
    expect(matchMarkdownLink('[a]()')).toBeNull();
  });

  it('returns null when there is no link pattern', () => {
    expect(matchMarkdownLink('just some text')).toBeNull();
    expect(matchMarkdownLink('[a] (https://example.com)')).toBeNull();
  });

  it('matches the last link when several precede it', () => {
    const m = matchMarkdownLink('[one](https://a.com) and [two](https://b.com)');
    expect(m?.text).toBe('two');
    expect(m?.href).toBe('https://b.com');
  });
});
