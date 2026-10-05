import type { SocialSnapshot } from './social';
export type TikTokVideo = SocialSnapshot['videos'][number];
export type TikTokMetric = 'views' | 'likes' | 'comments' | 'shares';
export function videoCounter(video: TikTokVideo, metric: TikTokMetric): number | null {
  const value = video.statistics[metric];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function inventoryTotal(videos: TikTokVideo[], metric: TikTokMetric) {
  const values = videos.map(v => videoCounter(v, metric)).filter((v): v is number => v !== null);
  return { value: values.length ? values.reduce((a, b) => a + b, 0) : null, reported: values.length, count: videos.length };
}
export function visibleTikTokVideos(videos: TikTokVideo[], search: string, sort: string) {
  return videos.map(v => ({ ...v, title: v.title.trim() || 'Untitled video' })).filter(v => v.title.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => {
    if (sort === 'views') return (videoCounter(b, 'views') ?? -1) - (videoCounter(a, 'views') ?? -1);
    const date = (v: TikTokVideo) => v.publishedAt && Number.isFinite(Date.parse(v.publishedAt)) ? Date.parse(v.publishedAt) : -Infinity;
    return date(b) - date(a);
  });
}
