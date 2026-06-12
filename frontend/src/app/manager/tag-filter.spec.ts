import { describe, expect, it } from 'vitest';
import { filterTagOptions } from './tag-filter';

const ALL = [
  { name: 'angular' },
  { name: 'TypeScript' },
  { name: 'rxjs' },
  { name: 'design' },
];

describe('filterTagOptions', () => {
  it('returns all tags when query is empty', () => {
    expect(filterTagOptions(ALL, [], '')).toEqual([
      'angular',
      'TypeScript',
      'rxjs',
      'design',
    ]);
  });

  it('excludes tags already on the note', () => {
    const result = filterTagOptions(ALL, ['rxjs', 'design'], '');
    expect(result).toEqual(['angular', 'TypeScript']);
    expect(result).not.toContain('rxjs');
    expect(result).not.toContain('design');
  });

  it('filters case-insensitively by query', () => {
    expect(filterTagOptions(ALL, [], 'type')).toEqual(['TypeScript']);
    expect(filterTagOptions(ALL, [], 'TYPE')).toEqual(['TypeScript']);
    expect(filterTagOptions(ALL, [], 'r')).toEqual(['angular', 'TypeScript', 'rxjs']);
  });

  it('excludes note tags case-insensitively', () => {
    // Note has 'ANGULAR' (different case) — should still be excluded
    expect(filterTagOptions(ALL, ['ANGULAR'], '')).not.toContain('angular');
  });

  it('returns empty array when all tags are excluded', () => {
    const noteTags = ALL.map((t) => t.name);
    expect(filterTagOptions(ALL, noteTags, '')).toEqual([]);
  });

  it('returns empty array when query matches nothing', () => {
    expect(filterTagOptions(ALL, [], 'zzz')).toEqual([]);
  });

  it('handles blank (whitespace-only) query as empty', () => {
    const result = filterTagOptions(ALL, [], '   ');
    expect(result).toHaveLength(ALL.length);
  });
});
