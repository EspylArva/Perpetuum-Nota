import { describe, expect, it } from 'vitest';
import { isSafeLinkUrl } from './safe-url';

describe('isSafeLinkUrl', () => {
  it('allows http/https/mailto', () => {
    expect(isSafeLinkUrl('http://example.com')).toBe(true);
    expect(isSafeLinkUrl('https://example.com/path?q=1')).toBe(true);
    expect(isSafeLinkUrl('mailto:a@b.com')).toBe(true);
  });

  it('allows relative, anchor, and bare-domain links', () => {
    expect(isSafeLinkUrl('/notes/1')).toBe(true);
    expect(isSafeLinkUrl('./rel')).toBe(true);
    expect(isSafeLinkUrl('#section')).toBe(true);
    expect(isSafeLinkUrl('example.com')).toBe(true);
  });

  it('blocks javascript/data/vbscript and other schemes', () => {
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeLinkUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeLinkUrl('file:///etc/passwd')).toBe(false);
  });

  it('blocks control-char / whitespace smuggling', () => {
    expect(isSafeLinkUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('java\nscript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('  javascript:alert(1)  ')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isSafeLinkUrl('')).toBe(false);
    expect(isSafeLinkUrl('   ')).toBe(false);
  });
});
