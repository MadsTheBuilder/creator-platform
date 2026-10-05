import { describe, expect, it } from 'vitest';
import { inventoryTotal, videoCounter, visibleTikTokVideos, type TikTokVideo } from './tiktok-overview';
const video = (id: string, views: number | null, publishedAt: string | null = null): TikTokVideo => ({ id, title: id, publishedAt, url: null, statistics: { views } });
describe('TikTok reported inventory', () => {
  it('distinguishes missing counters from real zero and reports partial coverage', () => {
    expect(inventoryTotal([video('a', 0), video('b', null), video('c', 5)], 'views')).toEqual({ value: 5, reported: 2, count: 3 });
    expect(inventoryTotal([], 'views').value).toBeNull();
    expect(inventoryTotal([video('a', null)], 'views').value).toBeNull();
  });
  it('rejects invalid provider counters', () => {
    for (const value of [-1, Infinity, NaN]) expect(videoCounter(video('a', value), 'views')).toBeNull();
  });
  it('sorts missing dates last without changing the source inventory', () => {
    const source = [video('Unknown', 0), video('Newest', 10, '2026-09-27'), video('Older', 20, '2026-09-01')];
    expect(visibleTikTokVideos(source, '', 'newest').map(v => v.id)).toEqual(['Newest', 'Older', 'Unknown']);
    expect(source[0].id).toBe('Unknown');
    expect(visibleTikTokVideos(source, ' OLD ', 'views').map(v => v.id)).toEqual(['Older']);
  });
});
