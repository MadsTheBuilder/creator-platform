import { describe, expect, it } from 'vitest';
import { engagementRate, reportSeries, statistic } from './youtube-overview';
import type { YouTubeSnapshot } from './youtube';
const snapshot: YouTubeSnapshot = {
  source: 'YouTube APIs', observedAt: '2026-09-27T09:00:00Z',
  window: { startDate: '2026-08-30', endDate: '2026-09-26' },
  channel: { id: 'channel', title: 'Channel', statistics: {} }, videos: [],
  analytics: { columnHeaders: [{ name: 'estimatedMinutesWatched' }, { name: 'day' }, { name: 'views' }], rows: [[2.5, '2026-09-26', 4], [10, '2026-09-19', 20], [3, '2026-09-20', 6], [999, '2026-09-27', 999]] },
  analyticsError: null, retention: null,
};
it('derives engagement only from fully reported counters', () => {
  expect(engagementRate(200, 10, 5, 1)).toBe('8.0%');
  expect(engagementRate(0, 1)).toBe('Unavailable'); expect(engagementRate(100, 1, null)).toBe('Unavailable');
});
describe('real YouTube report presentation', () => {
  it('selects the last seven complete UTC days using returned column names, without filling gaps', () => {
    expect(reportSeries(snapshot, 7, 'views')).toEqual({ startDate: '2026-09-20', endDate: '2026-09-26', points: [{ date: '2026-09-20', value: 6 }, { date: '2026-09-26', value: 4 }], total: 10 });
  });
  it('uses reported watch-time minutes rather than demo hours or current-day activity', () => {
    expect(reportSeries(snapshot, 28, 'estimatedMinutesWatched').total).toBe(15.5);
  });
  it('keeps analytics failures and unsupported columns unavailable instead of zero', () => {
    expect(reportSeries({ ...snapshot, analyticsError: 'quota_exceeded' }, 28, 'views').total).toBeNull();
    expect(reportSeries({ ...snapshot, analytics: null }, 28, 'views').total).toBeNull();
    expect(reportSeries({ ...snapshot, analytics: { columnHeaders: [{ name: 'day' }] } }, 28, 'views').total).toBeNull();
  });
  it('distinguishes a successful empty report from missing analytics and never invents daily points', () => {
    const result = reportSeries({ ...snapshot, analytics: { ...snapshot.analytics, rows: [] } }, 28, 'views');
    expect(result.total).toBe(0); expect(result.points).toEqual([]);
  });
  it('does not turn malformed counters into activity or invalid chart points', () => {
    expect(statistic({ viewCount: '0' }, 'viewCount')).toBe(0);
    for (const value of ['', 'NaN', '-1', true]) expect(statistic({ viewCount: value }, 'viewCount')).toBeNull();
    expect(statistic({}, 'likeCount')).toBeNull();
    expect(reportSeries({ ...snapshot, analytics: { ...snapshot.analytics, rows: [[1, '2026-09-25', 'not a number']] } }, 28, 'views').total).toBeNull();
  });
});
