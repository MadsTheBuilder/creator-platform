import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TikTokInventory } from './TikTokOverview';
it('shows honest empty inventory without fabricated content', () => {
  const html = renderToStaticMarkup(createElement(TikTokInventory, { videos: [], search: '' }));
  expect(html).toContain('No accessible public videos');
  expect(html).not.toContain('Open on TikTok');
});
it('escapes provider content and distinguishes unavailable counters and a real zero', () => {
  const html = renderToStaticMarkup(createElement(TikTokInventory, { search: '', videos: [{ id: 'one', title: '<script>title</script>', publishedAt: null, url: null, statistics: { views: 0, likes: null } }] }));
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  expect(html).toContain('0 lifetime views'); expect(html).toContain('Unavailable');
  expect(html).not.toContain('Open on TikTok');
});
it('gives blank provider titles an accessible fallback', () => {
  const html = renderToStaticMarkup(createElement(TikTokInventory, { search: '', videos: [{ id: 'one', title: '', publishedAt: null, url: null, statistics: {} }] }));
  expect(html).toContain('Untitled video');
});
