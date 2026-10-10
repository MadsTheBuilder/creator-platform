import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowance, allowed, costOf } from './firecrawl.ts';

test('only the calls keyword research makes are forwarded', () => {
  assert.ok(allowed({ alexandria: [{ provider: 'firecrawl-trends', capability: 'trends/related_queries', options: {} }] }));
  assert.ok(allowed({ alexandria: [{ provider: 'firecrawl-trends', capability: 'trends/interest_over_time', options: {} }] }));
  assert.ok(allowed({ url: 'https://www.youtube.com/results?search_query=claude+code&sp=CAMSAhAB', formats: ['markdown'] }));
  assert.ok(!allowed({ url: 'https://example.com/', formats: ['markdown'] }));
  assert.ok(!allowed({ url: 'https://www.youtube.com.evil.com/results?search_query=x' }));
  assert.ok(!allowed({ alexandria: [{ provider: 'other', capability: 'trends/related_queries' }] }));
  assert.ok(!allowed({ alexandria: [{ provider: 'firecrawl-trends', capability: 'trends/related_queries' }, { provider: 'firecrawl-trends', capability: 'trends/related_queries' }] }));
  assert.ok(!allowed(null));
});

test('costs come from Firecrawl, or the usual price', () => {
  assert.equal(costOf({ alexandria: [{}] }, { data: { creditsCost: 7 } }), 7);
  assert.equal(costOf({ url: 'x', formats: [{ type: 'json' }] }, { data: { metadata: { creditsUsed: 4 } } }), 4);
  assert.equal(costOf({ alexandria: [{}] }, null), 5);
  assert.equal(costOf({ url: 'x', formats: ['markdown'] }, {}), 1);
});

test('the guest allowance runs out and comes back the next day', () => {
  let day = '2026-10-10';
  const a = allowance(10, () => day);
  assert.equal(a.left('g'), 10);
  a.spend('g', 6); a.spend('g', 5);
  assert.equal(a.left('g'), 0);
  assert.equal(a.left('someone else'), 10);
  day = '2026-10-11';
  assert.equal(a.left('g'), 10);
});
