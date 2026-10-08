import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTopics, coveredBy, isPrimary, label, median, onTopic, topicScore, trendSlope, type Video } from './radar.ts';

test('scoring maths matches topic-radar', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(trendSlope([10, 10, 10, 10, 10, 10, 10, 10, 20, 20]), 2);
  assert.equal(trendSlope([1, 2]), null);
  const base = { breakout: 0, slope: 1, accel: null, sat: 0.1, covered_by: null };
  assert.equal(label({ ...base, breakout: 5, slope: 1.5 }), 'Rising');
  assert.equal(label(base), 'Flat');
  assert.equal(label({ ...base, breakout: 4, slope: 0.8 }), 'Spike');
  assert.equal(label({ ...base, sat: 0.9 }), 'Saturated');
  assert.equal(label({ ...base, breakout: 6, slope: 1.4, accel: -0.5 }), 'Peaked');
  assert.equal(label({ ...base, covered_by: 'x' }), 'Covered');
  assert.equal(topicScore({ breakout: 10, slope: 2, breadth: 8, fit: 1, sat: 0, accel: 1, peer_videos: 1, velocity: 1, uploads_14d: 0, covered_by: null, newest_days: 1 }), 1);
});

test('covered, on-topic and primary checks', () => {
  assert.ok(coveredBy('lok sabha speaker powers', ['Power of Lok Sabha Speaker']));
  assert.equal(coveredBy('rbi repo rate', ['Power of Lok Sabha Speaker']), null);
  assert.ok(onTopic('Supreme Court NSA detention verdict explained', ['nsa detention supreme court']));
  assert.ok(!onTopic('Gold price today', ['nsa detention supreme court']));
  assert.ok(isPrimary('https://main.sci.gov.in/judgment.pdf', 'IN'));
  assert.ok(!isPrimary('https://www.whitehouse.gov/x', 'IN'));   // a US .gov is not primary for an Indian topic
  assert.ok(!isPrimary('https://www.livelaw.in/x', 'IN'));
});

test('model topics keep only evidence that was actually collected', () => {
  const vids = new Map<string, Video>([['v1', { id: 'v1', title: 't', channel: 'c', cid: 'c', views: 1, age_h: 1, url: 'u' }]]);
  const urls = new Set(['https://a.in/1']);
  const { topics, checks } = cleanTopics({ topics: [
    { name: 'NSA detention ruling', keywords: ['nsa detention'], bucket: 'consumer rights', video_ids: ['v1', 'made-up'], news_urls: ['https://a.in/1'] },
    { name: 'One viral video', video_ids: ['v1'], news_urls: [] },
    { name: 'NSA detention ruling', video_ids: ['v1'], news_urls: ['https://a.in/1'] },
  ] }, vids, urls, ['consumer rights']);
  assert.equal(topics.length, 1);
  assert.deepEqual(topics[0].video_ids, ['v1']);
  assert.equal(topics[0].slug, 'nsa-detention-ruling');
  assert.equal(topics[0].bucket, 'consumer rights');
  // The monitoring record says what the server threw away and why.
  assert.equal(checks.returned, 3);
  assert.equal(checks.invented_citations, 1);
  assert.deepEqual(checks.dropped.map(d => d.reason), ['fewer than two collected sources', 'duplicate']);
});
