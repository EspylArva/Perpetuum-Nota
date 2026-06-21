import { describe, expect, it } from 'vitest';
import { dueGroups } from './due-group';

const NOW = new Date(2026, 5, 15, 10, 0, 0); // 2026-06-15 10:00 local (a Monday)

/** A note carrying a dueDate `offset` days from NOW (or null). */
function note(id: string, offset: number | null) {
  const dueDate =
    offset === null ? null : new Date(2026, 5, 15 + offset, 9, 0, 0).toISOString();
  return { id, dueDate };
}

describe('dueGroups', () => {
  it('orders buckets on the progressive scale, null last', () => {
    const groups = dueGroups(
      [
        note('later', 60),
        note('none', null),
        note('today', 0),
        note('past', -3),
        note('week', 10),
        note('tomorrow', 1),
        note('month', 20),
        note('thisweek', 3),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual([
      'Past due',
      'Today',
      'Tomorrow',
      'Thursday 18 June', // +3 days, dated separator
      'In one week',
      'In one month',
      'Later',
      'No due date',
    ]);
  });

  it('keeps incoming order within a group', () => {
    const groups = dueGroups([note('a', 0), note('b', 0)], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].notes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('gives each remaining day this week its own dated separator', () => {
    const groups = dueGroups([note('d4', 4), note('d5', 5)], NOW);
    expect(groups.map((g) => g.label)).toEqual([
      'Friday 19 June',
      'Saturday 20 June',
    ]);
  });
});
