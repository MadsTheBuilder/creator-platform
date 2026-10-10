import { describe, expect, it } from 'vitest';
import { parseResults } from './firecrawl';
import model from './model.json';
import sample from './sample.json';
import { scoreTitle, type Model } from './score';
import { suggestTitles, type Video } from './titles';

describe('keyword research port', () => {
  it('splits views and age that YouTube prints run together', () => {
    const md = '### [My \\| Video](https://www.youtube.com/watch?v=abcdefghijk)\n[Some Channel](https://www.youtube.com/@some)\n7453mo ago\n### [Big](https://www.youtube.com/watch?v=bbbbbbbbbbb)\n2.6M7mo ago';
    expect(parseResults(md)).toEqual([
      { title: 'My | Video', url: 'https://www.youtube.com/watch?v=abcdefghijk', channel: 'Some Channel', views: 745, age: '3mo ago' },
      { title: 'Big', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', channel: '', views: 2_600_000, age: '7mo ago' },
    ]);
  });

  it('scores titles and suggests 5 distinct ones from the sample', () => {
    const m = model as unknown as Model;
    const s = scoreTitle('I Replaced Cursor With Claude Code For 30 Days', m);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    const videos = (sample.videos as Record<string, Video[]>)['claude code'];
    const out = suggestTitles('claude code', '', videos, t => scoreTitle(t, m).score, [], (sample.ideas as any)['claude code']);
    expect(out.titles).toHaveLength(5);
    expect(new Set(out.titles.map(t => t.title)).size).toBe(5);
    expect(out.studied).toBeGreaterThan(0);
  });
});
