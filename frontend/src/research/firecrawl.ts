// Keyword research on Firecrawl (Trends + YouTube results pages), ported from fireIQ (public/lib/firecrawl.js).
// Calls go to the app server (/api/firecrawl in worker/firecrawl.ts), which holds the site's Firecrawl key and forwards
// only these calls; the shared guest account gets a daily allowance there. Signed out, or before the key is set,
// everything runs on fireIQ's saved "claude code" sample. Results are cached in this browser's IndexedDB.
import type { Ideas, Pattern, Trending, Video } from './titles';

const API = '/api/firecrawl';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type Opts = { geo: string; property: string; time: string };
export type Query = { query: string; value: number; formatted_value?: string; breakout?: boolean; explore_url?: string };
export type Related = { rising?: Query[]; top?: Query[] };
export type Interest = { keywords: string[]; points: { label: string; partial?: boolean; values: number[] }[] };
type Result<T> = { data: T; credits: number; cached: boolean };
type Sample = { seed: string; opts: Opts; savedAt: string; related: Record<string, Related>; interest: Record<string, Interest>; videos: Record<string, Video[]>; ideas: Record<string, Ideas> };

export class FirecrawlError extends Error {
  status: number; auth?: string;
  constructor(message: string, status: number, auth?: string) { super(message); this.status = status; this.auth = auth; }
}

// ---------- connection ----------
export type Account = { live: true; remaining: number | null; guestLeft: number | null } | { live: false; reason: string };
export async function account(): Promise<Account> {
  try {
    const r = await fetch(`${API}/credits`);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return { live: false, reason: 'Sign in to research your own topics.' };
    if (!r.ok) return { live: false, reason: j.error ?? `The research server answered ${r.status}.` };
    return { live: true, remaining: j.remaining ?? null, guestLeft: j.guest_left_today ?? null };
  } catch { return { live: false, reason: 'Could not reach the research server.' }; }
}
let live = false;
export const setLive = (on: boolean) => { live = on; };
let sample: Promise<Sample> | null = null;
export const loadSample = () => (sample ??= import('./sample.json').then(m => m.default as unknown as Sample));
async function fromSample<T>(kind: 'related' | 'interest' | 'videos' | 'ideas', key: string | false): Promise<Result<T>> {
  const data = key && (await loadSample())[kind][key.toLowerCase()];
  if (data) return { data: data as T, credits: 0, cached: true };
  throw new FirecrawlError('Sample data only covers "claude code" and a few of its keywords. Add a Firecrawl key to research anything.', 401, 'sample');
}

// ---------- cache ----------
let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= new Promise((resolve, reject) => {
  const req = indexedDB.open('content-engine-research', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('cache');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
}));
async function cacheGet(key: string): Promise<unknown> {
  try {
    const d = await db();
    return await new Promise(r => { const q = d.transaction('cache').objectStore('cache').get(key); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); });
  } catch { return undefined; }
}
async function cacheSet(key: string, value: unknown) { try { (await db()).transaction('cache', 'readwrite').objectStore('cache').put(value, key); } catch { /* cache is best effort */ } }
async function cached<T>(key: object, fn: () => Promise<{ data: T; credits: number }>): Promise<Result<T>> {
  const k = JSON.stringify(key), hit = await cacheGet(k);
  if (hit !== undefined) return { data: hit as T, credits: 0, cached: true };
  const r = await fn();
  await cacheSet(k, r.data);
  return { ...r, cached: false };
}

// ---------- requests ----------
// Firecrawl limits requests per minute per account, so at most 3 calls run at once and a 429 waits out
// the reset the API reports.
const MAX_ACTIVE = 3;
let active = 0;
const waiting: (() => void)[] = [];
async function request(path: string, body: object): Promise<any> {
  if (active >= MAX_ACTIVE) await new Promise<void>(r => waiting.push(r));
  active++;
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 429 && j.limit === 'guest') throw new FirecrawlError(j.error, 429, 'allowance');
      if (res.status === 429 && attempt < 3) { await sleep((Number(String(j.error).match(/retry after (\d+)s/)?.[1] ?? 20) + 1) * 1000); continue; }
      if (res.status === 401) throw new FirecrawlError('Sign in again to run research.', 401, 'signin');
      if (res.status === 402) throw new FirecrawlError('This Firecrawl account is out of credits.', 402, 'credits');
      if (!res.ok || j.success === false) throw new FirecrawlError(j.error || `Firecrawl error ${res.status}`, res.status);
      return j;
    }
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function alexandria<T>(provider: string, capability: string, options: object) {
  let credits = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const j = await request('/scrape', { alexandria: [{ provider, capability, options }] });
    credits += j.data?.creditsCost ?? 0;
    const item = j.data?.alexandria?.[0];
    if (item?.data) return { data: item.data as T, credits };
    const err = item?.error;
    if (err?.code !== 'provider_rate_limited') throw new FirecrawlError(err?.message ?? 'No data returned', 502);
    await sleep(((err.retryAfterSeconds ?? 2) + attempt * 2) * 1000);
  }
  throw new FirecrawlError('Still rate-limited after 5 tries', 429);
}

// Trends rejects parallel calls from one account (provider_rate_limited), so they run one at a time.
let trendsQueue: Promise<unknown> = Promise.resolve();
function trends<T>(capability: string, options: object) {
  const p = trendsQueue.then(() => alexandria<T>('firecrawl-trends', `trends/${capability}`, options));
  trendsQueue = p.catch(() => {});
  return p;
}

export const related = (keyword: string, o: Opts) => live
  ? cached({ related: { keyword, ...o } }, () => trends<Related>('related_queries', { keyword, ...o })) : fromSample<Related>('related', keyword);
export const interest = (keywords: string[], o: Opts) => { keywords = keywords.slice(0, 5); return live
  ? cached({ interest: { keywords, ...o } }, () => trends<Interest>('interest_over_time', { keywords, ...o })) : fromSample<Interest>('interest', keywords.length === 1 && keywords[0]); };

// ---------- YouTube ----------
// YouTube's own result pages, sorted by view count: all time, and uploaded this year. One scrape credit
// each, and unlike web search they carry views and upload age for every result.
const SORTS = { allTime: 'CAMSAhAB', thisYear: 'CAMSBAgFEAE%3D' };
const ytUrl = (q: string, sp: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${sp}`;
export function youtubeTop(query: string): Promise<Result<Video[]>> {
  if (!live) return fromSample<Video[]>('videos', query);
  return cached({ youtubeTop: query.toLowerCase() }, async () => {
    const pages = await Promise.allSettled(Object.values(SORTS).map(sp => request('/scrape', { url: ytUrl(query, sp), formats: ['markdown'] })));
    const seen = new Set<string>(), out: Video[] = [];
    let credits = 0;
    for (const p of pages) {
      if (p.status !== 'fulfilled') continue;
      credits += 1;
      for (const v of parseResults(p.value.data?.markdown ?? '')) {
        const id = new URL(v.url).searchParams.get('v');
        if (id && !seen.has(id)) { seen.add(id); out.push(v); }
      }
    }
    const failed = pages.find(p => p.status === 'rejected') as PromiseRejectedResult | undefined;
    if (!out.length) throw failed?.reason ?? new FirecrawlError('YouTube returned no results for this keyword', 404);
    return { data: out.sort((a, b) => b.views - a.views), credits };
  });
}

// Views and age are printed run together, e.g. "2.6M7mo ago" or "7453mo ago" (745 views, 3 months).
// Split at the first point where the rest is a plausible age.
const AGE_MAX: Record<string, number> = { s: 59, m: 59, min: 59, h: 23, d: 31, w: 5, wk: 5, mo: 11, y: 30, yr: 30 };
const MULT: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
function splitViewsAge(s: string) {
  for (let i = 1; i < s.length; i++) {
    const m = s.slice(i).match(/^(\d{1,2})\s?(mo|min|yr|wk|s|m|h|d|w|y)\s?ago$/);
    const views = s.slice(0, i).match(/^(\d+(?:\.\d+)?)([KMB]?)$/);
    if (m && views && Number(m[1]) >= 1 && Number(m[1]) <= AGE_MAX[m[2]])
      return { views: Math.round(Number(views[1]) * (MULT[views[2]] ?? 1)), age: `${m[1]}${m[2]} ago` };
  }
  return null;
}
export function parseResults(md: string): Video[] {
  const lines = md.split('\n'), out: Video[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^### \[(.+?)\]\((https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11})/);
    if (!h) continue;
    let channel = '', stats: ReturnType<typeof splitViewsAge> = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 25) && !stats; j++) {
      channel ||= lines[j].match(/^\[([^\]]+)\]\(https:\/\/www\.youtube\.com\/@/)?.[1] ?? '';
      stats = splitViewsAge(lines[j].trim());
    }
    if (stats) out.push({ title: h[1].replace(/\\([|\[\]_*])/g, '$1').trim(), url: h[2], channel, ...stats });
  }
  return out;
}

// Firecrawl's JSON format runs a language model over the page it scrapes (~5 credits). Pointed at YouTube's
// most-viewed results for a keyword, it reads what the subject is and what gets clicks, then writes titles.
// fireIQ's GLM route (OpenRouter) is left out: the Firecrawl path needs no second key.
export function titleIdeas(keyword: string, { about = '', trending = [] as Trending[], patterns = [] as Pattern[] } = {}): Promise<Result<Ideas>> {
  if (!live) return fromSample<Ideas>('ideas', keyword);
  const phrases = trending.map(t => t.query);
  return cached({ titleIdeas: keyword.toLowerCase(), about: about.toLowerCase(), phrases }, async () => {
    const angle = about ? `\n- The viewer's video: ${about}. Every title must be true to this video and never promise something it doesn't cover.` : '';
    const winning = patterns.length ? `\n- Title patterns among these videos by share of total views: ${patterns.map(p => `${p.name} ${Math.round(p.share * 100)}% (e.g. "${p.example}")`).join('; ')}. Lean on the patterns that earn the most views here, and use at least 4 different patterns.` : '';
    const searching = phrases.length ? `\n- People are searching YouTube for these right now: ${trending.map(t => `"${t.query}" (${t.label})`).join(', ')}. Work one of these into at least 4 of the titles, only where it reads naturally; never more than one per title.` : '';
    const prompt = `This page lists the most-viewed YouTube videos for "${keyword}". Read the titles, descriptions and view counts and work out what the subject actually is and what makes viewers click.

Then write 15 NEW titles for a video about "${keyword}". Rules:${angle}${winning}${searching}
- Be specific to this subject: use real names, features and comparisons from these videos, never filler like "game changer", "revolutionary" or "explored".
- Use what works here: first-person framing ("I tested…", "I replaced…"), a surprising claim, a comparison, or a direct challenge to the viewer.
- Never invent results or statistics. Only use a number if it appears on this page.
- No emoji, no em or en dashes (use a colon or a period instead), at most one exclamation mark across all titles, Title Case, under 65 characters.
- Every title takes a different angle and must not copy or lightly reword an existing title.
For each, give the existing title whose pattern it borrows.`;
    const j = await request('/scrape', {
      url: ytUrl(keyword, SORTS.allTime),
      formats: [{ type: 'json', prompt, schema: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'One sentence on what the subject is' },
          angles: { type: 'array', items: { type: 'string' }, description: 'What viewers find interesting about it' },
          titles: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, inspired_by: { type: 'string' } }, required: ['title', 'inspired_by'] } },
        },
        required: ['subject', 'titles'],
      } }],
    });
    const out = j.data?.json ?? {};
    return { data: { subject: out.subject ?? '', angles: out.angles ?? [], titles: (out.titles ?? []).filter((t: { title?: string }) => t?.title), model: 'firecrawl' }, credits: j.data?.metadata?.creditsUsed ?? 5 };
  });
}
