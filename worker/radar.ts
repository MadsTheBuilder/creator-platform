// Radar: content ideas for a creator, and a watchlist that keeps their saved ideas up to date.
// Ported from the topic-radar skill (~/.claude/skills/topic-radar): same scoring maths and labels, minus X/Reddit
// (mostly noise in the Indian Lawtuber runs) and page fetching. Sources: YouTube Data API (free quota),
// Google News through treg (Serper, $0.001 a call), Google Trends through SerpApi (free plan, 250 searches a month).
// A weekly scan collects the pool; the creator's own Claude or Codex groups it into ideas (save_radar_ideas over MCP).
// A daily watch checks saved ideas for news, original documents and new videos. No AI key lives on the server.
import type { SupabaseClient } from '@supabase/supabase-js';
import { setTimeout as sleep } from 'node:timers/promises';
import { JobError } from './job-error.ts';

type Channel = { id: string; name: string; subs: number; titles: string[]; checked_at: string };
type Profile = { user_id: string; channel_url: string; format: 'shorts' | 'long' | 'both'; region: string; seeds: string[]; buckets: string[]; channel: Channel | null };
export type Video = { id: string; title: string; channel: string; cid: string; views: number; age_h: number; url: string; subs?: number | null; x?: number | null; vph?: number };
type News = { title: string; url: string; source: string; date: string };
type Topic = { slug: string; name: string; summary: string; angle: string; keywords: string[]; query: string; bucket: string | null; video_ids: string[]; news_urls: string[] };
export type Metrics = { breakout: number; peer_videos: number; velocity: number; slope: number | null; accel: number | null; sat: number; uploads_14d: number; breadth: number; fit: number; covered_by: string | null; newest_days: number | null };

const SCAN_CAP_MICRO = 150_000, WATCH_CAP_MICRO = 60_000;   // ponytail: fixed per-run spend caps ($0.15 / $0.06); make them per-creator settings if anyone needs more
const SAT_N = 20, WATCHED_MAX = 15, DAY = 86_400_000;
const PRIMARY_BY_REGION: Record<string, string[]> = { IN: ['.gov.in', '.nic.in'], US: ['.gov', '.mil'], GB: ['.gov.uk'], AU: ['.gov.au'], CA: ['.gc.ca'] };
const PRIMARY_ANY = ['.int', '.europa.eu'];

// ---------- scoring maths (scoring.md in topic-radar) ----------

export const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 : 0; };
const words = (s: string, min: number) => new Set(s.toLowerCase().match(new RegExp(`[\\p{L}\\p{N}]{${min},}`, 'gu')) ?? []);
const overlap = (a: Set<string>, b: Set<string>) => a.size ? [...a].filter(w => b.has(w)).length / a.size : 0;

// mean of the last 2 weekly points / mean of the 8 before; null without enough data.
export function trendSlope(series: number[]): number | null {
  if (series.length < 6) return null;
  const recent = (series.at(-1)! + series.at(-2)!) / 2, base = series.slice(-10, -2);
  const mean = base.reduce((a, b) => a + b, 0) / base.length;
  return mean ? Math.round(recent / mean * 100) / 100 : recent ? 9.9 : null;
}

export function label(m: Pick<Metrics, 'breakout' | 'slope' | 'accel' | 'sat' | 'covered_by'>): string {
  const { breakout: b, slope: s, accel: a } = m;
  if (m.covered_by) return 'Covered';
  if (m.sat >= 0.8 && b < 5) return 'Saturated';
  if (a !== null && a < -0.3) return 'Peaked';
  if (s !== null && s < 0.9 && b < 3) return 'Flat';
  if (b >= 2 && ((s !== null && s >= 1.15) || (a !== null && a > 0.2))) return 'Rising';
  if (b >= 3) return s === null || s < 1 ? 'Spike' : 'Rising';
  return 'Flat';
}

export function topicScore(m: Metrics): number {
  const s = 0.30 * Math.min(m.breakout / 10, 1) + 0.25 * Math.min(Math.max((m.slope ?? 1) - 1, 0), 1) + 0.15 * Math.min(m.breadth / 8, 1)
    + 0.15 * m.fit + 0.15 * (1 - m.sat) + ((m.accel ?? 0) > 0 ? 0.1 : 0);
  return Math.round(Math.min(s, 1) * 1000) / 1000;
}

// The creator's own title sharing >=60% of the topic's 4+ letter words. A soft flag: the angle may still be new.
export const coveredBy = (name: string, titles: string[]) => titles.find(t => overlap(words(name, 4), words(t, 4)) >= 0.6) ?? null;
// YouTube pads search results with loosely related videos; count a title only if it shares >=60% of a keyword's words.
export const onTopic = (title: string, keywords: string[]) => keywords.some(k => overlap(words(k, 3), words(title, 3)) >= 0.6);

const domain = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
export function isPrimary(url: string, region: string) {
  const d = domain(url), suffixes = [...PRIMARY_ANY, ...(PRIMARY_BY_REGION[region] ?? Object.values(PRIMARY_BY_REGION).flat())];
  return suffixes.some(s => d.endsWith(s));
}
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ---------- providers ----------

class Spend {
  micro = 0; units = 0; capMicro: number;
  constructor(capMicro: number) { this.capMicro = capMicro; }
}

async function treg(spend: Spend, endpoint: string, body: object): Promise<any> {
  const key = process.env.TREG_API_KEY;
  if (!key) throw new JobError('News search is not set up (TREG_API_KEY is missing).');
  if (spend.micro >= spend.capMicro) throw new JobError(`Stopped at this run's spending cap ($${(spend.capMicro / 1e6).toFixed(2)}).`);
  const res = await fetch(`https://treg.to/call/${endpoint}`, { method: 'POST', headers: { 'X-Treg-Token': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  spend.micro += Number(res.headers.get('x-treg-cost-micro')) || 0;
  if (res.status === 402) throw new JobError('The treg balance has run out. Top it up, then try again.');
  if (!res.ok) { console.warn(`radar: ${endpoint} returned ${res.status}`); return {}; }
  return res.json().catch(() => ({}));
}

async function news(spend: Spend, q: string, region: string, tbs: string): Promise<News[]> {
  const d = await treg(spend, 'serper.google.serp.news', { q, gl: region.toLowerCase(), hl: 'en', tbs, num: 10 });
  return (d.news ?? []).filter((n: any) => /^https?:\/\//.test(n.link ?? '')).map((n: any) => ({ title: String(n.title ?? '').slice(0, 300), url: n.link, source: String(n.source ?? domain(n.link)), date: String(n.date ?? '') }));
}

async function yt(spend: Spend, path: string, units: number, params: Record<string, string>): Promise<any> {
  const key = process.env.YOUTUBE_DATA_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!key) throw new JobError('YouTube is not set up (YOUTUBE_DATA_API_KEY is missing).');
  spend.units += units;
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new JobError(`YouTube refused the request: ${body.error?.message ?? res.status}`);
  return body;
}

const ageH = (iso: string) => Math.max((Date.now() - Date.parse(iso)) / 3_600_000, 0.1);

async function videos(spend: Spend, ids: string[]): Promise<Video[]> {
  const out: Video[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await yt(spend, 'videos', 1, { part: 'snippet,statistics', id: ids.slice(i, i + 50).join(',') });
    for (const v of d.items ?? []) out.push({ id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, cid: v.snippet.channelId,
      views: Number(v.statistics?.viewCount ?? 0), age_h: ageH(v.snippet.publishedAt), url: `https://www.youtube.com/watch?v=${v.id}` });
  }
  return out;
}

// Recent videos for a query, most viewed first. ponytail: no language filter, so Hindi and English both come back.
async function search(spend: Spend, q: string, days: number, p: Profile): Promise<Video[]> {
  const params: Record<string, string> = { part: 'id', q, type: 'video', order: 'viewCount', maxResults: '50', regionCode: p.region,
    publishedAfter: new Date(Date.now() - days * DAY).toISOString().replace(/\.\d+Z$/, 'Z') };
  if (p.format !== 'both') params.videoDuration = p.format === 'shorts' ? 'short' : 'medium';
  const ids = (await yt(spend, 'search', 100, params)).items?.map((i: any) => i.id.videoId).filter(Boolean) ?? [];
  return ids.length ? (await videos(spend, ids)).sort((a, b) => b.views - a.views) : [];
}

// The creator's channel: name, subscribers and the last 50 upload titles (for the "already covered" check).
async function channel(spend: Spend, url: string): Promise<Channel> {
  const m = url.match(/youtube\.com\/(?:(@[\w.-]+)|channel\/(UC[\w-]+))/);
  if (!m) throw new JobError('Use a channel link like https://www.youtube.com/@handle.');
  const d = await yt(spend, 'channels', 1, { part: 'snippet,statistics,contentDetails', ...(m[1] ? { forHandle: m[1] } : { id: m[2] }) });
  const c = d.items?.[0];
  if (!c) throw new JobError('YouTube could not find that channel.');
  const items = await yt(spend, 'playlistItems', 1, { part: 'snippet', playlistId: c.contentDetails.relatedPlaylists.uploads, maxResults: '50' });
  return { id: c.id, name: c.snippet.title, subs: Number(c.statistics.subscriberCount ?? 0), titles: (items.items ?? []).map((i: any) => i.snippet.title), checked_at: new Date().toISOString() };
}

// Outlier multiple (views / that channel's median of its last 12 uploads), only for channels within ~10x of the
// creator: a big channel's win says nothing about what this creator can copy.
async function enrich(spend: Spend, rows: Video[], mine: number) {
  const cids = [...new Set(rows.map(r => r.cid))], subs = new Map<string, number>();
  for (let i = 0; i < cids.length; i += 50)
    for (const c of (await yt(spend, 'channels', 1, { part: 'statistics', id: cids.slice(i, i + 50).join(',') })).items ?? []) subs.set(c.id, Number(c.statistics.subscriberCount ?? 0));
  for (const r of rows) { r.subs = subs.get(r.cid) ?? null; r.vph = Math.round(r.views / Math.max(r.age_h, 6) * 10) / 10; }
  const medians = new Map<string, number | null>();
  for (const r of rows.filter(r => r.subs !== null && r.subs! <= 10 * Math.max(mine, 1)).sort((a, b) => b.vph! - a.vph!)) {
    if (medians.has(r.cid) || medians.size >= 15) continue;
    try {   // the uploads playlist id is the channel id with UU instead of UC
      const ids = (await yt(spend, 'playlistItems', 1, { part: 'contentDetails', playlistId: 'UU' + r.cid.slice(2), maxResults: '12' })).items?.map((i: any) => i.contentDetails.videoId) ?? [];
      const views = (await videos(spend, ids)).map(v => v.views).filter(Boolean);
      medians.set(r.cid, views.length ? median(views) : null);
    } catch (cause) { console.warn(`radar: channel ${r.cid}`, cause instanceof Error ? cause.message : cause); medians.set(r.cid, null); }   // one bad channel must not sink the run
  }
  for (const r of rows) { const m = medians.get(r.cid); r.x = m ? Math.round(r.views / m * 10) / 10 : null; }
}

// Google Trends weekly interest over 12 months, keywords summed. Null when SerpApi is missing or has no data.
async function slope(keywords: string[], region: string): Promise<number | null> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://serpapi.com/search.json?${new URLSearchParams({ engine: 'google_trends', q: keywords.slice(0, 5).join(','), geo: region, date: 'today 12-m', data_type: 'TIMESERIES', api_key: key })}`, { signal: AbortSignal.timeout(30_000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { console.warn('radar: trends', d.error ?? res.status); return null; }
  return trendSlope((d.interest_over_time?.timeline_data ?? []).map((t: any) => (t.values ?? []).reduce((a: number, v: any) => a + (Number(v.extracted_value) || 0), 0)));
}

// The server's checks on the model's topics. Every drop and every invented citation is reported, so the
// monitoring record shows how much of the model's answer survived and why.
export function cleanTopics(raw: any, vids: Map<string, Video>, urls: Set<string>, buckets: string[]) {
  const str = (v: unknown, n: number) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const seen = new Set<string>(), dropped: { name: string; reason: string }[] = [];
  let invented = 0;
  const raws: any[] = Array.isArray(raw?.topics) ? raw.topics : [];
  const topics: Topic[] = raws.flatMap(t => {
    const name = str(t?.name, 120), slug = slugify(name);
    if (!name || !slug) { dropped.push({ name: name || '(no name)', reason: 'no usable name' }); return []; }
    if (seen.has(slug)) { dropped.push({ name, reason: 'duplicate' }); return []; }
    seen.add(slug);
    const keywords = list(t.keywords).map(k => k.trim().slice(0, 60)).filter(Boolean).slice(0, 5);
    const video_ids = list(t.video_ids).filter(id => vids.has(id)), news_urls = list(t.news_urls).filter(u => urls.has(u));
    invented += list(t.video_ids).length - video_ids.length + list(t.news_urls).length - news_urls.length;
    if (video_ids.length + news_urls.length < 2) { dropped.push({ name, reason: 'fewer than two collected sources' }); return []; }   // invented or single-source evidence is dropped, not trusted
    return [{ slug, name, summary: str(t.summary, 600), angle: str(t.angle, 400), keywords: keywords.length ? keywords : [name], query: str(t.query, 100) || keywords[0] || name,
      bucket: buckets.includes(t.bucket) ? t.bucket : null, video_ids, news_urls }];
  });
  return { topics, checks: { returned: raws.length, kept: topics.length, dropped, invented_citations: invented } };
}

// ---------- runs ----------

type Trace = { db: SupabaseClient; runId: string; userId: string };

async function profileFor(db: SupabaseClient, spend: Spend, userId: string): Promise<Profile> {
  const { data, error } = await db.from('radar_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new JobError('Add your channel and topics first.');
  const p = data as Profile;
  if (!p.seeds.length) throw new JobError('Add at least one topic to search.');
  if (!p.channel || Date.now() - Date.parse(p.channel.checked_at) > 7 * DAY) {
    p.channel = await channel(spend, p.channel_url);
    await db.from('radar_profiles').update({ channel: p.channel }).eq('user_id', userId);
  }
  return p;
}

// Collects a week of videos and three days of news per seed topic and stores the pool on the run.
// Grouping it into ideas is the creator's Claude's job: get_radar_run, then save_radar_ideas.
async function scan(db: SupabaseClient, trace: Trace, spend: Spend) {
  const p = await profileFor(db, spend, trace.userId);
  const { data: known } = await db.from('radar_ideas').select('name').eq('user_id', trace.userId).in('status', ['saved', 'dropped', 'archived']);
  const byId = new Map<string, Video>(), items: News[] = [], bySeed: Record<string, { video_ids: string[]; news_urls: string[] }> = {};
  for (const seed of p.seeds) {
    const found = bySeed[seed] = { video_ids: [] as string[], news_urls: [] as string[] };
    for (const v of await search(spend, seed, 7, p)) { byId.set(v.id, v); found.video_ids.push(v.id); }
    for (const n of await news(spend, seed, p.region, 'qdr:d3')) { found.news_urls.push(n.url); if (!items.some(i => i.url === n.url)) items.push(n); }
  }
  const vids = [...byId.values()];
  await enrich(spend, vids, p.channel!.subs);
  vids.sort((a, b) => (b.x ?? 0) - (a.x ?? 0) || b.vph! - a.vph!);
  const creator = { channel: p.channel!.name, subscribers: p.channel!.subs, format: p.format, region: p.region, buckets: p.buckets, recent_titles: p.channel!.titles.slice(0, 25), skip_saved_or_dropped: (known ?? []).map(k => k.name) };
  await db.from('radar_runs').update({ raw: { creator, seeds: bySeed, videos: vids, news: items } }).eq('id', trace.runId);
  return { videos: vids.length, news: items.length, youtube_units: spend.units, next: 'Ask your Claude to turn this scan into ideas.' };
}

// Called by the creator's Claude over MCP with the topics it grouped from a scan's pool. The server drops any
// topic without two collected sources, scores the rest (14-day search, Google Trends) and replaces last week's new ideas.
export async function saveIdeas(db: SupabaseClient, userId: string, runId: string, input: unknown) {
  const { data: run } = await db.from('radar_runs').select('kind,status,raw,summary').eq('id', runId).eq('user_id', userId).maybeSingle();
  const raw = run?.raw as { videos?: Video[]; news?: News[] } | null;
  if (!run || run.kind !== 'scan' || run.status !== 'done' || !raw?.videos) throw new JobError('That is not a finished scan. Call list_radar_runs and use a scan whose status is done.');
  const spend = new Spend(SCAN_CAP_MICRO);
  const p = await profileFor(db, spend, userId);
  const byId = new Map(raw.videos.map(v => [v.id, v])), items = raw.news ?? [];
  const { data: known } = await db.from('radar_ideas').select('slug').eq('user_id', userId).in('status', ['saved', 'dropped', 'archived']);
  const cleaned = cleanTopics(input, byId, new Set(items.map(i => i.url)), p.buckets);
  const topics = cleaned.topics.filter(t => !(known ?? []).some(k => k.slug === t.slug));
  const dropped = [...cleaned.checks.dropped, ...cleaned.topics.filter(t => !topics.includes(t)).map(t => ({ name: t.name, reason: 'already saved, dropped or archived' }))];
  if (!topics.length) throw new JobError(`No topic was kept. Each needs two or more videos/headlines copied exactly from the pool. Dropped: ${JSON.stringify(dropped)}`);

  // Score: a fresh 14-day search per topic (saturation), Google Trends for the strongest six (SerpApi's free plan is small).
  const scored = [];
  for (const t of topics) {
    const vs = t.video_ids.map(id => byId.get(id)!), peers = vs.filter(v => v.subs != null && v.subs <= 10 * Math.max(p.channel!.subs, 1));
    const found = await search(spend, t.query, 14, p), recent = found.filter(r => onTopic(r.title, t.keywords));
    const m: Metrics = { breakout: Math.max(0, ...peers.map(v => v.x ?? 0)), peer_videos: peers.length, velocity: Math.max(0, ...peers.map(v => v.vph ?? 0)),
      slope: null, accel: null, sat: Math.round(Math.min(recent.length / SAT_N, 1) * 100) / 100, uploads_14d: recent.length,
      breadth: new Set(vs.map(v => v.cid)).size + new Set(t.news_urls.map(domain)).size, fit: t.bucket ? 1 : 0.4,
      covered_by: coveredBy(t.name, p.channel!.titles), newest_days: vs.length ? Math.round(Math.min(...vs.map(v => v.age_h)) / 24 * 10) / 10 : null };
    scored.push({ t, m, vs, found: found.map(v => ({ id: v.id, title: v.title, channel: v.channel, views: v.views, on_topic: recent.includes(v) })) });
  }
  scored.sort((a, b) => topicScore(b.m) - topicScore(a.m));
  for (const s of scored.slice(0, 6)) s.m.slope = await slope(s.t.keywords, p.region);
  await db.from('radar_runs').update({ raw: { ...raw, scoring: scored.map(s => ({ topic: s.t.name, query: s.t.query, slope: s.m.slope, search_14d: s.found })) } }).eq('id', runId);

  // A scan replaces last week's undecided ideas; saved, dropped and archived ones stay.
  await db.from('radar_ideas').delete().eq('user_id', userId).eq('status', 'new');
  const rows = scored.map(({ t, m, vs }) => ({
    user_id: userId, run_id: runId, slug: t.slug, name: t.name, summary: t.summary, angle: t.angle, keywords: t.keywords, query: t.query, bucket: t.bucket,
    status: 'new', label: label(m), score: topicScore(m), metrics: m, updated_at: new Date().toISOString(),
    evidence: [
      ...vs.map(v => ({ kind: 'video', title: v.title, url: v.url, source: v.channel, date: `${Math.round(v.age_h / 24)} days ago`, views: v.views, x: v.x })),
      ...t.news_urls.map(u => items.find(i => i.url === u)!).map(n => ({ kind: isPrimary(n.url, p.region) ? 'document' : 'news', title: n.title, url: n.url, source: n.source, date: n.date })),
    ],
  }));
  const { data: saved, error } = await db.from('radar_ideas').insert(rows).select('id,name,label,score');
  if (error) throw error;
  await db.from('radar_runs').update({ summary: { ...(run.summary as object), ideas: rows.length }, cost_micro: spend.micro }).eq('id', runId);
  return { saved: rows.length, ideas: saved ?? [], dropped, invented_citations: cleaned.checks.invented_citations };
}

async function watch(db: SupabaseClient, trace: Trace, spend: Spend) {
  const userId = trace.userId;
  const p = await profileFor(db, spend, userId);
  const { data: ideas, error } = await db.from('radar_ideas').select('id,name,query,keywords,last_checked,metrics').eq('user_id', userId).eq('status', 'saved')
    .order('last_checked', { ascending: true, nullsFirst: true }).limit(WATCHED_MAX);
  if (error) throw error;
  let found = 0;
  for (const idea of ideas ?? []) {
    const since = idea.last_checked ? Date.now() - Date.parse(idea.last_checked) : Infinity;
    const days = since < 2 * DAY ? 2 : 7;   // overlap a little; repeats are dropped by the (idea, url) key
    const items = await news(spend, idea.query || idea.name, p.region, `qdr:${days === 2 ? 'd2' : 'w'}`);
    const vids = (await search(spend, idea.query || idea.name, days, p)).filter(v => onTopic(v.title, idea.keywords)).slice(0, 5);
    const rows = [
      ...items.map(n => ({ kind: isPrimary(n.url, p.region) ? 'document' : 'news', title: n.title, url: n.url, source: n.source, published: n.date })),
      ...vids.map(v => ({ kind: 'video', title: v.title, url: v.url, source: v.channel, published: `${Math.round(v.age_h / 24)} days ago` })),
    ].map(r => ({ ...r, idea_id: idea.id, user_id: userId }));
    const { data: added, error: addError } = rows.length
      ? await db.from('radar_updates').upsert(rows, { onConflict: 'idea_id,url', ignoreDuplicates: true }).select('kind,title,source')
      : { data: [], error: null };
    if (addError) throw addError;
    const fresh = added ?? [];
    found += fresh.length;
    const previous = (idea.metrics as { watch?: { news: number; videos: number } }).watch;
    const direction = !previous ? '' : items.length + vids.length > previous.news + previous.videos ? ' Coverage is picking up.' : items.length + vids.length < previous.news + previous.videos ? ' Coverage is slowing down.' : '';
    const note = fresh.length ? `${fresh.length} new: ${count(fresh, 'document')} official documents, ${count(fresh, 'news')} reports, ${count(fresh, 'video')} videos.${direction}` : `Nothing new since the last check.${direction}`;
    await db.from('radar_ideas').update({ change_note: note, last_checked: new Date().toISOString(),
      metrics: { ...(idea.metrics as object), watch: { news: items.length, videos: vids.length } } }).eq('id', idea.id);
  }
  return { watched: ideas?.length ?? 0, new_items: found, youtube_units: spend.units };
}
const count = (rows: { kind: string }[], kind: string) => rows.filter(r => r.kind === kind).length;

// ---------- schedule and queue ----------

// Daily watch for creators with saved ideas, weekly scan for every creator. Failed runs count too,
// so a broken key cannot make the loop spend again and again.
async function schedule(db: SupabaseClient) {
  const { data: profiles } = await db.from('radar_profiles').select('user_id');
  for (const { user_id } of profiles ?? []) {
    const { data: runs } = await db.from('radar_runs').select('kind,created_at').eq('user_id', user_id).order('created_at', { ascending: false }).limit(20);
    const last = (kind: string) => runs?.find(r => r.kind === kind)?.created_at;
    const due = (kind: string, every: number) => { const at = last(kind); return !at || Date.now() - Date.parse(at) > every; };
    const { count: saved } = await db.from('radar_ideas').select('id', { count: 'exact', head: true }).eq('user_id', user_id).eq('status', 'saved');
    // Unique index allows one waiting run of each kind, so a duplicate insert is simply refused.
    if (due('scan', 7 * DAY)) await db.from('radar_runs').insert({ user_id, kind: 'scan' });
    if (saved && due('watch', 20 * 3_600_000)) await db.from('radar_runs').insert({ user_id, kind: 'watch' });
  }
}

async function claim(db: SupabaseClient) {
  const { data } = await db.from('radar_runs').select('id').eq('status', 'queued').order('created_at').limit(1);
  if (!data?.length) return null;
  const { data: run } = await db.from('radar_runs').update({ status: 'running' }).eq('id', data[0].id).eq('status', 'queued').select('id,user_id,kind').maybeSingle();
  return run as { id: string; user_id: string; kind: 'scan' | 'watch' } | null;
}

export async function runRadar(db: SupabaseClient, signal: AbortSignal) {
  // ponytail: assumes a single worker, like the video job loop; a run left "running" by a restart is failed.
  await db.from('radar_runs').update({ status: 'failed', error: 'Interrupted by a server restart. Please try again.', finished_at: new Date().toISOString() }).eq('status', 'running');
  let nextSchedule = 0;
  while (!signal.aborted) {
    try {
      if (Date.now() > nextSchedule) { await schedule(db); nextSchedule = Date.now() + 10 * 60_000; }
      const run = await claim(db);
      if (!run) { await sleep(15_000, undefined, { signal }).catch(() => {}); continue; }
      const spend = new Spend(run.kind === 'scan' ? SCAN_CAP_MICRO : WATCH_CAP_MICRO);
      console.log(`radar ${run.kind} ${run.id} started`);
      try {
        const trace = { db, runId: run.id, userId: run.user_id };
        const summary = run.kind === 'scan' ? await scan(db, trace, spend) : await watch(db, trace, spend);
        await db.from('radar_runs').update({ status: 'done', summary, cost_micro: spend.micro, finished_at: new Date().toISOString() }).eq('id', run.id);
        console.log(`radar ${run.kind} ${run.id} done`, summary, `$${(spend.micro / 1e6).toFixed(3)}`);
      } catch (cause) {
        console.error(`radar ${run.kind} ${run.id} failed`, cause);
        await db.from('radar_runs').update({ status: 'failed', cost_micro: spend.micro, finished_at: new Date().toISOString(),
          error: cause instanceof JobError ? cause.message : 'Something went wrong on our side. Please try again.' }).eq('id', run.id);
      }
    } catch (cause) { console.error('radar loop error', cause); await sleep(60_000, undefined, { signal }).catch(() => {}); }
  }
}
