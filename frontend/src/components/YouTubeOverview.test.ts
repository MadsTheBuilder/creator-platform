import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { YouTubeOverviewChart, YouTubeUploads } from './YouTubeOverview';
it('renders real zero observations without division by zero or bridging missing dates', () => {
  const html = renderToStaticMarkup(createElement(YouTubeOverviewChart, { metric: 'views', report: { startDate: '2026-09-20', endDate: '2026-09-26', total: 0, points: [{ date: '2026-09-20', value: 0 }, { date: '2026-09-22', value: 0 }] } }));
  expect(html).not.toMatch(/NaN|Infinity/); expect(html).not.toContain('<path');
  expect(html).toContain('Latest reported day:'); expect(html).toContain('2026-09-22');
});
it('renders unavailable reports without a synthetic chart or fabricated total', () => {
  const html = renderToStaticMarkup(createElement(YouTubeOverviewChart, { metric: 'views', report: { startDate: '2026-09-20', endDate: '2026-09-26', total: null, points: [] } }));
  expect(html).toContain('Unavailable'); expect(html).not.toContain('<svg'); expect(html).not.toContain('<strong>0</strong>');
});
it('renders an empty owned-upload inventory without demo videos', () => {
  const html = renderToStaticMarkup(createElement(YouTubeUploads, { videos: [], search: '' }));
  expect(html).toContain('No accessible uploads'); expect(html).not.toContain('Watch on YouTube');
});
it('escapes provider titles and keeps missing lifetime counters unavailable', () => {
  const html = renderToStaticMarkup(createElement(YouTubeUploads, { search: '', videos: [{ id: 'video', title: '<script>bad</script>', publishedAt: '2026-09-21T12:00:00Z', statistics: { viewCount: '4' } }] }));
  expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('Unavailable'); expect(html).toContain('https://www.youtube.com/watch?v=video');
});
