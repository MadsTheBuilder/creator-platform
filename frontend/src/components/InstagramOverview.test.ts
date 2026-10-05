import { describe, expect, it } from 'vitest';
import { dailySeries, totalOf } from './InstagramOverview';
describe('Instagram overview helpers', () => {
  it('sums reported values and skips unavailable ones', () => expect(totalOf([3, null, 4])).toBe(7));
  it('stays unavailable when nothing is reported', () => expect(totalOf([null, undefined])).toBeNull());
  it('charts only reported days', () => {
    const day = (date: string, views: number | null) => ({ date, views, reach: null, likes: null, comments: null, shares: null, saves: null, total_interactions: null });
    const report = dailySeries({ startDate: '2026-09-01', endDate: '2026-09-03', days: [day('2026-09-01', 5), day('2026-09-02', null), day('2026-09-03', 0)], follows: null, unfollows: null }, 'views');
    expect(report.points).toEqual([{ date: '2026-09-01', value: 5 }, { date: '2026-09-03', value: 0 }]);
    expect(report.total).toBe(5);
  });
});
