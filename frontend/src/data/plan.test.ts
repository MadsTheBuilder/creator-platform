import { describe, expect, it } from 'vitest';
import { addDays, matchCandidates, monthGrid } from './plan';

describe('calendar days', () => {
  it('lays a month out in six Monday-first weeks', () => {
    const grid = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-09-28'); expect(grid[3]).toBe('2026-10-01'); expect(grid[41]).toBe('2026-11-08');
  });
  it('steps across month, year and DST boundaries one day at a time', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('matching a posted item to its upload', () => {
  const uploads = [
    { id: 'old', title: 'Budget travel in Goa', publishedAt: '2026-09-01T10:00:00Z', url: null },
    { id: 'near', title: 'Day in my life', publishedAt: '2026-10-14T18:00:00Z', url: null },
    { id: 'title', title: 'I tried the Goa budget travel hack', publishedAt: '2026-10-16T09:00:00Z', url: null },
    { id: 'undated', title: 'Goa budget travel', publishedAt: null, url: null },
  ];
  it('ranks title overlap first, then closeness to the planned day, and skips uploads from before it', () => {
    expect(matchCandidates({ title: 'Goa budget travel hack', scheduled_on: '2026-10-14' }, uploads).map(u => u.id)).toEqual(['title', 'near']);
  });
  it('considers every upload for an unscheduled item', () => {
    expect(matchCandidates({ title: 'Something else', scheduled_on: null }, uploads).map(u => u.id)).toEqual(['title', 'near', 'old', 'undated']);
  });
});
