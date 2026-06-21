import { describe, expect, it } from 'vitest';
import {
  parseWikiTarget,
  scanWikilinks,
  slugifyHeading,
} from './wikilink-parse';

describe('parseWikiTarget', () => {
  it('parses a bare title with no heading', () => {
    expect(parseWikiTarget('Note')).toEqual({
      title: 'Note',
      heading: null,
      raw: 'Note',
    });
  });

  it('splits title and heading on the first #', () => {
    expect(parseWikiTarget('Note#Section')).toEqual({
      title: 'Note',
      heading: 'Section',
      raw: 'Note#Section',
    });
  });

  it('keeps later # characters inside the heading (splits on FIRST # only)', () => {
    expect(parseWikiTarget('Note#Section#Sub')).toEqual({
      title: 'Note',
      heading: 'Section#Sub',
      raw: 'Note#Section#Sub',
    });
  });

  it('trims surrounding whitespace from title and heading', () => {
    expect(parseWikiTarget('  My Note  #  Some Heading  ')).toEqual({
      title: 'My Note',
      heading: 'Some Heading',
      raw: 'My Note#Some Heading',
    });
  });

  it('returns null for an empty inner string', () => {
    expect(parseWikiTarget('')).toBeNull();
  });

  it('returns null for a whitespace-only title', () => {
    expect(parseWikiTarget('   ')).toBeNull();
  });

  it('returns null when the title before # is empty', () => {
    expect(parseWikiTarget('#Heading')).toBeNull();
  });

  it('treats a trailing # as an empty (but non-null) heading', () => {
    expect(parseWikiTarget('Note#')).toEqual({
      title: 'Note',
      heading: '',
      raw: 'Note#',
    });
  });
});

describe('scanWikilinks', () => {
  it('returns no matches for text without links', () => {
    expect(scanWikilinks('just plain text')).toEqual([]);
  });

  it('finds a single link with correct offsets and inner text', () => {
    // "go [[Home]] now"
    //  0123456789...
    //  "[[" starts at index 3, full match "[[Home]]" is 8 chars → to = 11
    const result = scanWikilinks('go [[Home]] now');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ from: 3, to: 11, inner: 'Home' });
  });

  it('finds multiple links in one string', () => {
    const result = scanWikilinks('[[A]] and [[B#sec]]');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ from: 0, to: 5, inner: 'A' });
    expect(result[1]).toMatchObject({ inner: 'B#sec' });
    // Offsets line up with the actual substring positions.
    expect('[[A]] and [[B#sec]]'.slice(result[1].from, result[1].to)).toBe(
      '[[B#sec]]',
    );
  });

  it('handles adjacent links with no separating text', () => {
    const result = scanWikilinks('[[A]][[B]]');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ from: 0, to: 5, inner: 'A' });
    expect(result[1]).toEqual({ from: 5, to: 10, inner: 'B' });
  });

  it('returns empty-inner matches for [[]]', () => {
    const result = scanWikilinks('x [[]] y');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ from: 2, to: 6, inner: '' });
  });

  it('does not match links whose inner text contains brackets', () => {
    // The inner run rejects further [ or ], so a nested bracket breaks the match.
    expect(scanWikilinks('[[a[b]]')).toEqual([]);
  });

  it('is reusable across calls (regex lastIndex is reset each call)', () => {
    expect(scanWikilinks('[[A]]')).toHaveLength(1);
    expect(scanWikilinks('[[A]]')).toHaveLength(1);
  });
});

describe('slugifyHeading', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugifyHeading('My Cool Section')).toBe('my-cool-section');
  });

  it('trims and collapses whitespace runs to a single dash', () => {
    expect(slugifyHeading('  My   Cool  Section  ')).toBe('my-cool-section');
  });

  it('strips punctuation that is not alphanumeric or dash', () => {
    expect(slugifyHeading('Hello, World!')).toBe('hello-world');
  });

  it('keeps digits', () => {
    expect(slugifyHeading('Section 2 Notes')).toBe('section-2-notes');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(slugifyHeading('   ')).toBe('');
  });

  it('produces matching slugs for the same heading regardless of casing/spacing', () => {
    expect(slugifyHeading('Some Heading')).toBe(slugifyHeading('  some   heading '));
  });
});
