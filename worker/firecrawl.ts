// Trends › Keyword research (ported from fireIQ, github.com/RichardBray/fireiq): the site's Firecrawl key, held here,
// for every signed-in account, the shared guest included. Only the calls the research view makes are forwarded,
// so the key can't scrape arbitrary sites. The guest link is public, so the guest gets a daily credit allowance.
import type { Hono } from 'hono';

const FIRECRAWL = 'https://api.firecrawl.dev/v2';
const TRENDS = new Set(['trends/related_queries', 'trends/interest_over_time']);

export function allowed(body: any) {
  if (body?.alexandria) {
    const calls = Array.isArray(body.alexandria) ? body.alexandria : [body.alexandria];
    return calls.length === 1 && calls[0]?.provider === 'firecrawl-trends' && TRENDS.has(calls[0]?.capability);
  }
  return typeof body?.url === 'string' && body.url.startsWith('https://www.youtube.com/results?search_query=');
}

// What a call cost, from Firecrawl's answer; the usual price when it doesn't say.
export function costOf(body: any, answer: any) {
  const reported = Number(answer?.data?.creditsCost ?? answer?.data?.metadata?.creditsUsed);
  if (reported > 0) return reported;
  return body?.alexandria ? 5 : Array.isArray(body?.formats) && body.formats.some((f: any) => f?.type === 'json') ? 5 : 1;
}

// ponytail: in memory, per worker, resets on a restart; move to a table if the guest allowance gets abused.
export function allowance(limit: number, today = () => new Date().toISOString().slice(0, 10)) {
  const spent = new Map<string, { day: string; credits: number }>();
  const used = (user: string) => { const s = spent.get(user); return s?.day === today() ? s.credits : 0; };
  return {
    left: (user: string) => Math.max(0, limit - used(user)),
    spend: (user: string, credits: number) => spent.set(user, { day: today(), credits: used(user) + credits }),
  };
}

type Env = { Variables: { user: string } };
export function mountFirecrawl(app: Hono<Env>, isGuest: (user: string) => boolean) {
  const guest = allowance(Number(process.env.GUEST_FIRECRAWL_DAILY) || 300);
  const key = () => process.env.FIRECRAWL_API_KEY;
  const notSetUp = { error: 'Keyword research is not set up on this site.' };

  app.get('/api/firecrawl/credits', async c => {
    if (!key()) return c.json(notSetUp, 503);
    const r = await fetch(`${FIRECRAWL}/team/credit-usage`, { headers: { authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const j: any = await r?.json().catch(() => ({}));
    if (!r?.ok) return c.json({ error: 'Firecrawl is not answering right now.' }, 502);
    const d = j.data ?? j, user = c.get('user');
    return c.json({ remaining: d.remainingCredits ?? d.remaining_credits ?? null, ...(isGuest(user) ? { guest_left_today: guest.left(user) } : {}) });
  });

  app.post('/api/firecrawl/scrape', async c => {
    if (!key()) return c.json(notSetUp, 503);
    const body = await c.req.json().catch(() => null), user = c.get('user');
    if (!allowed(body)) return c.json({ error: "This request isn't one keyword research makes." }, 400);
    if (isGuest(user) && guest.left(user) <= 0) return c.json({ error: "Today's research allowance for the shared guest account is used up. Try again tomorrow.", limit: 'guest' }, 429);
    const r = await fetch(`${FIRECRAWL}/scrape`, { method: 'POST', headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    const text = await r.text();
    if (r.ok && isGuest(user)) { let answer = null; try { answer = JSON.parse(text); } catch { /* counted at the usual price */ } guest.spend(user, costOf(body, answer)); }
    // The site's key failing is our problem, not the visitor's sign-in: never pass a 401 through.
    if (r.status === 401 || r.status === 403) { console.error('firecrawl rejected the site key', r.status); return c.json({ error: 'Keyword research is not available right now.' }, 502); }
    return new Response(text, { status: r.status, headers: { 'content-type': 'application/json' } });
  });
}
