import { useEffect, useState, type FormEvent } from 'react';
import { CalendarPlus, Fire, MagnifyingGlass, Star, TrendUp, X } from '@phosphor-icons/react';
import { Button, CopyButton, Notice } from '../components/ui';
import { useAppServer, useSession } from '../data/hooks';
import { createItem } from '../data/plan';
import { account, interest, loadSample, related, setLive, titleIdeas, youtubeTop, type Account, type Interest, type Opts, type Related } from '../research/firecrawl';
import { loadModel, scoreTitle, type Model } from '../research/score';
import { patterns, relevant, suggestTitles, type Suggestions, type Trending, type Video } from '../research/titles';
import { Radar } from './Radar';
import './research.css';

// Trends has two views: Radar's weekly ideas (#trends) and keyword research ported from fireIQ (#trends/research).
export function Trends({ topic, onTopic, onConnections }: { topic?: string; onTopic: (id?: string) => void; onConnections: () => void }) {
  const research = topic === 'research';
  return <>
    <div className="platform-tabs kr-switch" role="group" aria-label="Trends view">
      <a className={research ? '' : 'active'} aria-current={research ? undefined : 'page'} href="#trends">Video ideas</a>
      <a className={research ? 'active' : ''} aria-current={research ? 'page' : undefined} href="#trends/research">Keyword research</a>
    </div>
    {research ? <Research/> : <Radar topic={topic} onTopic={onTopic} onConnections={onConnections}/>}
  </>;
}

type Load<T> = T | 'loading' | { error: string };
const failed = (x: unknown): x is { error: string } => typeof x === 'object' && x !== null && 'error' in x;
type Candidate = { query: string; seeds: string[]; rising: string | number | null; top: number | null; breakout: boolean; rise_value: number };

const fmt = (n: number | null | undefined) => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
const message = (e: unknown) => (e as Error).message;
const parseSeeds = (text: string) => [...new Set(text.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))].slice(0, 6);
const store = {
  get<T>(k: string, d: T): T { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* per-browser convenience only */ } },
};

// Rising and most-searched queries from every seed, merged into one row per query.
function merge(byseed: Record<string, Load<Related>>, seeds: string[]): Candidate[] {
  const cands: Record<string, Candidate> = {};
  for (const seed of seeds) {
    const d = byseed[seed];
    if (!d || d === 'loading' || failed(d)) continue;
    for (const kind of ['rising', 'top'] as const)
      for (const q of d[kind] ?? []) {
        const c = (cands[q.query] ??= { query: q.query, seeds: [], rising: null, top: null, breakout: false, rise_value: 0 });
        if (!c.seeds.includes(seed)) c.seeds.push(seed);
        if (kind === 'top') c.top = q.value;
        else { c.rising = q.formatted_value ?? q.value; c.breakout ||= !!q.breakout; c.rise_value = Math.max(c.rise_value, q.value || 0); }
      }
  }
  return Object.values(cands).filter(c => c.query !== seeds[0]);
}
// Change of the last 7 days against the days before them.
function momentum(data: Interest, query: string) {
  const i = data.keywords.indexOf(query), s = data.points.filter(p => !p.partial).map(p => p.values[i]);
  if (s.length < 8) return null;
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length, recent = avg(s.slice(-7)), earlier = avg(s.slice(0, -7));
  return !recent && !earlier ? 'low' : earlier ? Math.round((recent / earlier - 1) * 100) : 100;
}
const trendingFrom = (d: Related, keyword: string): Trending[] => {
  const kw = keyword.toLowerCase();
  const rising = (d.rising ?? []).filter(q => q.query.toLowerCase() !== kw).slice(0, 8).map(q => ({ query: q.query, label: q.breakout ? 'Breakout' : 'Rising' }));
  const top = (d.top ?? []).filter(q => q.query.toLowerCase() !== kw && !rising.some(r => r.query === q.query)).slice(0, 4).map(q => ({ query: q.query, label: 'Most searched' }));
  return [...rising, ...top];
};
// YouTube only shows rough ages ("8d ago"), so views per day is an estimate; under a day counts as one.
const DAYS: Record<string, number> = { s: 1 / 86400, m: 1 / 1440, min: 1 / 1440, h: 1 / 24, d: 1, w: 7, wk: 7, mo: 30, y: 365, yr: 365 };
const perDay = (v: Video) => { const m = v.age.match(/(\d+)\s?(mo|min|yr|wk|s|m|h|d|w|y)/); return v.views / (m ? Math.max(1, Number(m[1]) * DAYS[m[2]]) : 365); };
// The same search on Google Trends (public). Firecrawl's own explore links (trends.firecrawl.dev) sit behind a Vercel login.
const googleTrends = (q: string, o: Opts) => `https://trends.google.com/trends/explore?${new URLSearchParams({ q, date: o.time, ...(o.geo ? { geo: o.geo } : {}), ...(o.property ? { gprop: o.property } : {}) })}`;
const tone = (s: number) => s >= 70 ? 'good' : s >= 50 ? 'mid' : 'low';

function Research() {
  const session = useSession();
  const server = useAppServer();   // the app server's session cookie, which /api/firecrawl needs
  const [acct, setAcct] = useState<Account | null>(null);
  const [view, setView] = useState<'keywords' | 'videos' | 'titles'>('keywords');
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<Opts>({ geo: 'US', time: 'today 1-m', property: 'youtube' });
  const [result, setResult] = useState<{ seeds: string[]; opts: Opts; related: Record<string, Load<Related>> } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [charts, setCharts] = useState<Record<string, Load<Interest>>>({});
  const [kwMode, setKwMode] = useState<'rising' | 'top'>('rising');
  const [compare, setCompare] = useState<string[]>([]);
  const [comparison, setComparison] = useState<{ keys: string[]; data: Load<Interest> } | null>(null);
  const [videos, setVideos] = useState<Record<string, Load<Video[]>>>({});
  const [videoKw, setVideoKw] = useState<string | null>(null);
  const [hot, setHot] = useState(true);
  const [model, setModel] = useState<Model | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => { void loadModel().then(setModel); }, []);
  // Once the cookie is synced (or sync failed: signed out), ask the server whether live research is available.
  const checked = server !== 'connecting';
  useEffect(() => {
    if (!checked) return;
    void account().then(async a => {
      setLive(a.live); setAcct(a);
      if (!a.live) { const s = await loadSample(); setQ(s.seed); void research([s.seed], s.opts); }
    });
  }, [checked]);

  async function research(seeds: string[], o: Opts) {
    if (!seeds.length) return;
    setResult({ seeds, opts: o, related: Object.fromEntries(seeds.map(s => [s, 'loading'])) });
    setSelected(null); setCompare([]); setComparison(null); setView('keywords');
    const out: Record<string, Load<Related>> = {};
    await Promise.all(seeds.map(async seed => {
      try { out[seed] = (await related(seed, o)).data; } catch (e) { out[seed] = { error: message(e) }; }
      setResult(r => r && r.seeds === seeds ? { ...r, related: { ...r.related, [seed]: out[seed] } } : r);
    }));
    const first = merge(out, seeds).filter(c => c.rising != null).sort(byRise)[0];
    if (first) select(first.query, o);
  }
  function select(query: string, o = result?.opts ?? opts) {
    setSelected(query);
    if (!charts[query]) {
      setCharts(c => ({ ...c, [query]: 'loading' }));
      interest([query], o).then(r => r.data, e => ({ error: message(e) })).then(d => setCharts(c => ({ ...c, [query]: d })));
    }
    fetchVideos(query);
  }
  function fetchVideos(keyword: string) {
    if (videos[keyword] && videos[keyword] !== 'loading' && !failed(videos[keyword])) return;
    setVideos(v => ({ ...v, [keyword]: 'loading' }));
    youtubeTop(keyword).then(r => relevant(keyword, r.data), e => ({ error: message(e) })).then(d => setVideos(v => ({ ...v, [keyword]: d })));
  }
  async function runCompare() {
    const keys = [...compare];
    setComparison({ keys, data: 'loading' });
    const data = await interest(keys, result!.opts).then(r => r.data, e => ({ error: message(e) }));
    setComparison({ keys, data });
  }
  async function plan(title: string, notes: string) {
    setStatus('');
    try { await createItem({ title: title.slice(0, 140), platform: 'youtube', notes: notes.slice(0, 5000) }); setStatus(`Added “${title}” to your Planner’s Ideas.`); }
    catch (e) { setStatus(message(e)); }
  }

  const all = result ? merge(result.related, result.seeds) : [];
  const rising = all.filter(c => c.rising != null).sort(byRise), top = all.filter(c => c.top != null).sort((a, b) => b.top! - a.top!);
  const loading = result ? Object.values(result.related).includes('loading') : false;
  const errors = result ? result.seeds.flatMap(s => { const d = result.related[s]; return failed(d) ? [`${s}: ${d.error}`] : []; }) : [];
  const submit = (e: FormEvent) => { e.preventDefault(); void research(parseSeeds(q), opts); };
  const canPlan = !!session;
  const planTitle = canPlan ? undefined : 'Sign in to add to your Planner';

  return <div className="kr">
    {acct && (acct.live
      ? <p className="muted kr-acct">Live research on Firecrawl{acct.guestLeft != null ? ` · shared guest account: ${acct.guestLeft.toLocaleString()} credits left today` : acct.remaining != null ? ` · ${acct.remaining.toLocaleString()} credits left` : ''}. A topic costs about 5 credits, a chart 5, a keyword’s videos 2, a set of titles about 5. Repeats are free (cached in this browser).</p>
      : <Notice><span><strong>Sample data.</strong> You’re exploring fireIQ’s saved run for “claude code”. {acct.reason}</span></Notice>)}
    {status && <div className="notice" role="status">{status}</div>}

    <div className="platform-tabs" role="group" aria-label="Research">
      {([['keywords', 'Keywords'], ['videos', 'Videos'], ['titles', 'Title Lab']] as const).map(([v, label]) =>
        <button key={v} className={view === v ? 'active' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>)}
    </div>

    {view !== 'titles' && <form className="glass kr-search" onSubmit={submit}>
      <label className="kr-q"><MagnifyingGlass size={18} aria-hidden/><input value={q} onChange={e => setQ(e.target.value)} placeholder="Topics, comma separated (up to 6)" aria-label="Topics" disabled={acct?.live === false}/></label>
      <select aria-label="Time range" value={opts.time} onChange={e => setOpts({ ...opts, time: e.target.value })}><option value="now 7-d">Past 7 days</option><option value="today 1-m">Past 30 days</option><option value="today 3-m">Past 90 days</option><option value="today 12-m">Past 12 months</option></select>
      <select aria-label="Country" value={opts.geo} onChange={e => setOpts({ ...opts, geo: e.target.value })}><option value="US">United States</option><option value="IN">India</option><option value="GB">United Kingdom</option><option value="">Worldwide</option></select>
      <select aria-label="Searches on" value={opts.property} onChange={e => setOpts({ ...opts, property: e.target.value })}><option value="youtube">YouTube</option><option value="">Web</option><option value="news">News</option></select>
      <Button className="primary" disabled={!acct?.live || !parseSeeds(q).length || loading}>Research</Button>
    </form>}

    {view === 'keywords' && (!result ? <p className="muted">Search for a topic to see what people are searching for around it.</p> : <>
      {errors.length > 0 && <div className="notice" role="alert">No data for {errors.join('; ')}</div>}
      {comparison && <section className="glass kr-panel">
        <div className="kr-head"><h2>Comparing {comparison.keys.length} keywords</h2><Button onClick={() => setComparison(null)}><X size={16} aria-hidden/>Close</Button></div>
        <ChartOf data={comparison.data} keys={comparison.keys}/>
        <p className="muted kr-note">All lines share one 0–100 scale, so they compare directly.</p>
      </section>}
      {selected && <KeywordCard c={all.find(c => c.query === selected) ?? { query: selected, seeds: [], rising: null, top: null, breakout: false, rise_value: 0 }} opts={result.opts} chart={charts[selected]}
        onVideos={() => { setVideoKw(selected); setView('videos'); }} onTitles={() => setView('titles')}
        onPlan={() => { const v = videos[selected]; const c = all.find(x => x.query === selected);
          void plan(selected, `From keyword research (Firecrawl Trends, ${result.opts.geo || 'worldwide'}, ${result.opts.time}).\n${c?.breakout ? 'Breakout search' : c?.rising != null ? `Rising ${c.rising}` : ''}${c?.top != null ? ` · search size ${c.top}/100` : ''}${c?.seeds.length ? ` · found under ${c.seeds.join(', ')}` : ''}\n\nTop videos:\n${Array.isArray(v) ? v.slice(0, 5).map(x => `- ${x.title} (${fmt(x.views)} views, ${x.age}) ${x.url}`).join('\n') : '(not loaded)'}`); }}
        canPlan={canPlan} planTitle={planTitle}/>}
      <section className="glass kr-panel">
        <div className="kr-head">
          <div className="platform-tabs" role="group" aria-label="Keyword list">
            <button className={kwMode === 'rising' ? 'active' : ''} aria-pressed={kwMode === 'rising'} onClick={() => setKwMode('rising')}><TrendUp size={16} aria-hidden/>Rising</button>
            <button className={kwMode === 'top' ? 'active' : ''} aria-pressed={kwMode === 'top'} onClick={() => setKwMode('top')}><MagnifyingGlass size={16} aria-hidden/>Most searched</button>
          </div>
          {compare.length > 0 && <span className="toolbar-actions"><span className="muted">{compare.length} of 5 selected</span><Button onClick={() => setCompare([])}>Clear</Button><Button className="primary" disabled={compare.length < 2} onClick={() => void runCompare()}>Compare</Button></span>}
        </div>
        <KeywordTable rows={kwMode === 'top' ? top : rising} loading={loading} selected={selected} compare={compare}
          onSelect={k => select(k)} onToggle={k => setCompare(c => c.includes(k) ? c.filter(x => x !== k) : [...c, k].slice(0, 5))}/>
      </section>
    </>)}

    {view === 'videos' && (!result ? <p className="muted">Search for a topic first.</p> : (() => {
      const kw = videoKw ?? selected ?? result.seeds[0];
      const choices = [...new Set([...result.seeds, ...(selected ? [selected] : []), kw])];
      return <>
        <div className="kr-chips">{choices.map(k => <button key={k} className={`button ${k === kw ? 'primary' : ''}`} onClick={() => { setVideoKw(k); fetchVideos(k); }}>{k}</button>)}</div>
        <Videos kw={kw} data={videos[kw]} fetch={() => fetchVideos(kw)} hot={hot} setHot={setHot} model={model}/>
      </>;
    })())}

    {view === 'titles' && <TitleLab model={model} initial={selected ?? result?.seeds[0] ?? ''} opts={result?.opts ?? opts} live={!!acct?.live}
      onPlan={(t, notes) => void plan(t, notes)} canPlan={canPlan} planTitle={planTitle}/>}
  </div>;
}
const byRise = (a: Candidate, b: Candidate) => (Number(b.breakout) - Number(a.breakout)) || (b.rise_value - a.rise_value) || ((b.top ?? -1) - (a.top ?? -1));

function KeywordTable({ rows, loading, selected, compare, onSelect, onToggle }: { rows: Candidate[]; loading: boolean; selected: string | null; compare: string[]; onSelect: (k: string) => void; onToggle: (k: string) => void }) {
  if (!rows.length) return <p className="muted">{loading ? 'Asking Firecrawl Trends…' : 'Nothing here for these topics.'}</p>;
  return <div className="kr-table"><table>
    <thead><tr><th aria-label="Compare"/><th>Keyword</th><th className="kr-hide-sm">Found under</th><th>Search size</th><th>Change</th></tr></thead>
    <tbody>{rows.map(c => { const on = compare.includes(c.query); return <tr key={c.query} className={selected === c.query ? 'kr-on' : ''}>
      <td><input type="checkbox" checked={on} disabled={!on && compare.length >= 5} onChange={() => onToggle(c.query)} aria-label={`Compare ${c.query}`}/></td>
      <td><button className="kr-link" onClick={() => onSelect(c.query)}>{c.query}</button></td>
      <td className="muted kr-hide-sm">{c.seeds.join(', ')}</td>
      <td>{c.top == null ? <span className="muted">–</span> : <span className={`kr-badge kr-${c.top >= 40 ? 'good' : c.top >= 15 ? 'mid' : 'low'}`}>{c.top}</span>}</td>
      <td>{c.rising == null ? <span className="muted">–</span> : c.breakout ? <span className="kr-badge kr-fire"><Fire size={12} aria-hidden/>Breakout</span> : <span className="kr-up">↗ {String(c.rising).replace(/^\+/, '')}</span>}</td>
    </tr>; })}</tbody>
  </table></div>;
}

function KeywordCard({ c, opts, chart, onVideos, onTitles, onPlan, canPlan, planTitle }: { c: Candidate; opts: Opts; chart?: Load<Interest>; onVideos: () => void; onTitles: () => void; onPlan: () => void; canPlan: boolean; planTitle?: string }) {
  const m = chart && chart !== 'loading' && !failed(chart) ? momentum(chart, c.query) : null;
  return <section className="glass kr-panel kr-card">
    <div>
      <h2>{c.query}</h2>
      <p className="muted">{c.seeds.length ? `Rising under ${c.seeds.join(', ')}` : 'Keyword'}</p>
      <ul className="radar-facts">
        <li>Change: <strong>{c.breakout ? 'Breakout' : c.rising ?? '–'}</strong></li>
        <li>Search size: <strong>{c.top ?? '–'}</strong>{c.top != null && '/100'}</li>
        <li>Last 7 days: <strong>{m == null ? '–' : m === 'low' ? 'Low' : `${m >= 0 ? '+' : ''}${m}%`}</strong></li>
      </ul>
      <div className="toolbar-actions">
        <Button className="primary" onClick={onTitles}>Suggest titles</Button>
        <Button onClick={onVideos}>Top videos</Button>
        <Button disabled={!canPlan} title={planTitle} onClick={onPlan}><CalendarPlus size={16} aria-hidden/>Add to Planner</Button>
        <a className="button" href={googleTrends(c.query, opts)} target="_blank" rel="noreferrer">Open in Google Trends ↗</a>
      </div>
    </div>
    <div><p className="muted kr-note">Search interest, 0–100 (100 = busiest day)</p><ChartOf data={chart} keys={[c.query]}/></div>
  </section>;
}

const LINE = ['var(--orange)', '#8fb6d8', '#4ade80', '#c084fc', '#fdd5a5'];
function ChartOf({ data, keys }: { data?: Load<Interest>; keys: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data || data === 'loading') return <div className="kr-skel" style={{ height: 200 }}/>;
  if (failed(data)) return <p className="muted">{data.error}</p>;
  const pts = data.points.filter(p => !p.partial), idx = keys.map(k => data.keywords.indexOf(k));
  if (!pts.some(p => idx.some(i => p.values[i] > 0))) return <p className="muted">Too few searches to chart yet. Trends marks it as rising, but the volume is still below its 0–100 floor.</p>;
  const W = 640, H = 220, L = 34, R = 10, T = 10, B = 26;
  const x = (j: number) => L + (j / Math.max(1, pts.length - 1)) * (W - L - R), y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const line = (i: number) => pts.map((p, j) => `${x(j).toFixed(1)},${y(p.values[i]).toFixed(1)}`).join(' ');
  const ticks = [...new Set([0, 0.5, 1].map(f => Math.round(f * (pts.length - 1))))];
  const avg = (i: number) => Math.round(pts.reduce((n, p) => n + p.values[i], 0) / pts.length);
  return <figure className="kr-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Search interest for ${keys.join(', ')}`}
      onMouseMove={e => { const b = e.currentTarget.getBoundingClientRect(); const vx = (e.clientX - b.left) / b.width * W; setHover(Math.max(0, Math.min(pts.length - 1, Math.round((vx - L) / (W - L - R) * (pts.length - 1))))); }}
      onMouseLeave={() => setHover(null)}>
      {[0, 50, 100].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--rim)"/><text x={L - 6} y={y(v) + 4} textAnchor="end" className="kr-tick">{v}</text></g>)}
      {ticks.map(j => <text key={j} x={x(j)} y={H - 6} textAnchor={j === 0 ? 'start' : j === pts.length - 1 ? 'end' : 'middle'} className="kr-tick">{pts[j].label.replace(/,?\s*\d{4}$/, '')}</text>)}
      {idx.map((i, n) => <polyline key={n} points={line(i)} fill="none" stroke={LINE[n]} strokeWidth="2.5" strokeLinejoin="round"/>)}
      {hover != null && <><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--faint)" strokeDasharray="3 3"/>{idx.map((i, n) => <circle key={n} cx={x(hover)} cy={y(pts[hover].values[i])} r="4" fill={LINE[n]}/>)}</>}
    </svg>
    <figcaption className="kr-legend">{hover != null
      ? <><span>{pts[hover].label}</span>{keys.map((k, n) => <span key={k}><i style={{ background: LINE[n] }}/>{k}: <strong>{pts[hover].values[idx[n]]}</strong></span>)}</>
      : keys.map((k, n) => <span key={k}><i style={{ background: LINE[n] }}/>{k} · avg {avg(idx[n])}</span>)}</figcaption>
  </figure>;
}

function Videos({ kw, data, fetch, hot, setHot, model }: { kw: string; data?: Load<Video[]>; fetch: () => void; hot: boolean; setHot: (h: boolean) => void; model: Model | null }) {
  useEffect(() => { if (!data) fetch(); }, [kw]);
  if (!data || data === 'loading') return <div className="kr-videos">{Array.from({ length: 8 }, (_, i) => <div key={i} className="kr-skel" style={{ aspectRatio: '16/9' }}/>)}</div>;
  if (failed(data)) return <p className="muted">{data.error}</p>;
  if (!data.length) return <p className="muted">YouTube returned no on-topic videos for this keyword.</p>;
  // "Hot right now" compares views per day, so recent videos taking off stand out from old ones that had years to collect views.
  const metric = hot ? perDay : (v: Video) => v.views;
  const list = [...data].sort((a, b) => metric(b) - metric(a));
  const median = list.map(metric).sort((a, b) => a - b)[list.length >> 1] || 1;
  return <section className="glass kr-panel">
    <div className="kr-head"><h2>{hot ? 'Taking off' : 'Most viewed'} for “{kw}”</h2>
      <div className="platform-tabs" role="group" aria-label="Sort"><button className={hot ? 'active' : ''} aria-pressed={hot} onClick={() => setHot(true)}>Hot right now</button><button className={hot ? '' : 'active'} aria-pressed={!hot} onClick={() => setHot(false)}>Most viewed</button></div>
    </div>
    <p className="muted kr-note">{hot ? `Views per day against the median of YouTube’s top results for this keyword (≈ ${fmt(Math.round(median))} a day). YouTube rounds ages, so this is an estimate.` : `Views against the median of YouTube’s top results for this keyword (${fmt(median)}).`} The multiple is against these results, not each channel’s own average.</p>
    <div className="kr-videos">{list.map(v => { const mult = metric(v) / median, id = new URL(v.url).searchParams.get('v'), s = model ? scoreTitle(v.title, model).score : null;
      return <a key={v.url} className="kr-video" href={v.url} target="_blank" rel="noreferrer">
        <span className="kr-thumb"><img src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer"/>{mult >= 1.5 && <span className={`kr-x ${mult >= 3 ? 'kr-x-hot' : ''}`}>{mult >= 10 ? Math.round(mult) : mult.toFixed(1).replace(/\.0$/, '')}x</span>}</span>
        <strong>{v.title}</strong>
        <span className="muted">{fmt(v.views)} views · {v.age}{v.channel && ` · ${v.channel}`}{hot && ` · ≈ ${fmt(Math.round(perDay(v)))}/day`}</span>
        {s != null && <span className="muted">Title score <span className={`kr-badge kr-${tone(s)}`}>{s}</span></span>}
      </a>; })}</div>
  </section>;
}

const NAMES: Record<string, string> = {
  len: 'Length', words: 'Word count', stub: 'Too short', number: 'Has a number', curiosity: 'Curiosity words', narrative: 'Story framing', second_person: 'Talks to “you”',
  audience: 'Audience words', question: 'Question', colon: 'Colon', parens: 'Brackets', bang: 'Exclamation', caps: 'Capitals', dry: 'Dry opener', vs: 'Versus', depth: 'Depth framing',
  conflict: 'Conflict framing', accusation: '“You’re doing it wrong”', first_person_result: '“I did X” result', explained_suffix: '“…Explained”', e_comparison: 'Comparison',
  e_credibility: 'Credibility', e_curiosity: 'Curiosity', e_desire: 'Desire', e_extreme: 'Extreme words', e_list: 'List', e_negativity: 'Negativity', e_question: 'Question', e_time: 'Time',
};
function Breakdown({ title, model }: { title: string; model: Model }) {
  const r = scoreTitle(title, model);
  const rows: [string, number][] = Object.entries(r.contributions).map(([k, v]) => [NAMES[k] ?? k, v]);
  if (Math.abs(r.vocab) >= 0.5) rows.push(['Topic words', r.vocab]);
  rows.sort((p, q) => Math.abs(q[1]) - Math.abs(p[1]));
  const max = Math.max(5, ...rows.map(p => Math.abs(p[1])));
  return <div className="kr-why">
    <p><span className={`kr-badge kr-${tone(r.score)}`}>{r.score}</span> {r.score >= 70 ? 'Strong title' : r.score >= 50 ? 'Could be stronger' : 'Weak title'} · {r.chars} characters · {r.words} words</p>
    {rows.slice(0, 8).map(([n, v]) => <div key={n} className="kr-factor"><span>{n}</span><span className="kr-bar"><i className={v >= 0 ? 'kr-pos' : 'kr-neg'} style={{ left: `${v >= 0 ? 50 : 50 - Math.abs(v) / max * 50}%`, width: `${Math.abs(v) / max * 50}%` }}/></span><span>{v >= 0 ? '+' : ''}{v.toFixed(1)}</span></div>)}
    {!rows.length && <p className="muted">Nothing stands out.</p>}
  </div>;
}

type Saved = { title: string; keyword: string; at: number };
const STEPS = ['Reading YouTube’s most-viewed videos', 'Checking what people search for now', 'Writing titles with Firecrawl’s language model', 'Scoring and ranking'];
function TitleLab({ model, initial, opts, live, onPlan, canPlan, planTitle }: { model: Model | null; initial: string; opts: Opts; live: boolean; onPlan: (t: string, notes: string) => void; canPlan: boolean; planTitle?: string }) {
  const [kw, setKw] = useState(initial);
  const [about, setAbout] = useState('');
  const [sug, setSug] = useState<Load<Suggestions & { keyword: string }> | null>(null);
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [mine, setMine] = useState('');
  const [saved, setSaved] = useState<Saved[]>(() => store.get('ce.research.saved', []));
  const isSaved = (t: string) => saved.some(x => x.title.toLowerCase() === t.toLowerCase());
  const toggle = (t: string) => { const next = isSaved(t) ? saved.filter(x => x.title.toLowerCase() !== t.toLowerCase()) : [{ title: t, keyword: kw, at: Date.now() }, ...saved].slice(0, 100); setSaved(next); store.set('ce.research.saved', next); };

  async function suggest(more: boolean) {
    const keyword = kw.trim();
    if (!keyword || !model) return;
    const exclude = more && sug && !failed(sug) && sug !== 'loading' && sug.keyword === keyword ? shown : [];
    setSug('loading'); setStep(0); setOpen(null);
    try {
      const top = (await youtubeTop(keyword)).data;
      setStep(1);
      const trending = await related(keyword, opts).then(r => trendingFrom(r.data, keyword), () => []);
      setStep(2);
      const ideas = await titleIdeas(keyword, { about: about.trim(), trending, patterns: patterns(relevant(keyword, top)).slice(0, 6) }).catch(() => null);
      setStep(3);
      const next = suggestTitles(keyword, '', top, t => scoreTitle(t, model).score, exclude, ideas?.data ?? null, trending);
      if (!next.studied && !ideas) throw new Error('None of YouTube’s top videos for this keyword were on topic. Try a broader keyword.');
      setShown([...exclude, ...next.titles.map(t => t.title)]);
      setSug({ ...next, keyword });
    } catch (e) { setSug({ error: message(e) }); }
  }
  if (!model) return <p role="status">Loading the title model…</p>;
  const list = saved.map(x => ({ ...x, score: scoreTitle(x.title, model).score })).sort((a, b) => b.score - a.score);
  const s = sug && sug !== 'loading' && !failed(sug) ? sug : null;
  const notes = (t: Suggestions['titles'][number], keyword: string) => `Title idea for “${keyword}” from Title Lab · score ${t.score}/100 · pattern: ${t.pattern}${t.match ? ` · uses the ${t.match.label.toLowerCase()} search “${t.match.query}”` : ''}${t.inspired_by ? `\nInspired by: ${t.inspired_by}${t.inspired_views ? ` (${fmt(t.inspired_views)} views)` : ''} ${t.inspired_url ?? ''}` : ''}`;

  return <div className="kr">
    <form className="glass kr-search" onSubmit={e => { e.preventDefault(); void suggest(false); }}>
      <label className="kr-q"><MagnifyingGlass size={18} aria-hidden/><input value={kw} onChange={e => setKw(e.target.value)} placeholder="Keyword, e.g. claude code" aria-label="Keyword"/></label>
      <Button className="primary" disabled={!kw.trim() || sug === 'loading'}>Suggest 5 titles</Button>
      {live && <textarea className="kr-about" rows={2} maxLength={500} value={about} onChange={e => setAbout(e.target.value)} placeholder="What’s your video about? Optional. The titles stay true to it."/>}
    </form>
    {!live && <p className="muted kr-note">Sample titles are ready for: claude code, claude mods, claude code mods.</p>}

    {sug === 'loading' && <ol className="kr-steps">{STEPS.map((t, i) => <li key={t} className={i < step ? 'kr-done' : i === step ? 'kr-now' : ''}>{t}</li>)}</ol>}
    {failed(sug) && <div className="notice" role="alert">{sug.error}</div>}
    {s && <section className="glass kr-panel">
      {s.subject && <p><strong>What this is about:</strong> {s.subject}</p>}
      <ul className="kr-titles">{s.titles.map(t => <li key={t.title}>
        <div className="kr-title-row">
          <button className={`kr-star ${isSaved(t.title) ? 'kr-star-on' : ''}`} aria-pressed={isSaved(t.title)} aria-label={`Save ${t.title}`} onClick={() => toggle(t.title)}><Star size={18} weight={isSaved(t.title) ? 'fill' : 'regular'}/></button>
          <button className="kr-link kr-title" aria-expanded={open === t.title} onClick={() => setOpen(open === t.title ? null : t.title)}>{t.title}</button>
          <span className={`kr-badge kr-${tone(t.score)}`}>{t.score}</span>
        </div>
        <p className="muted kr-meta">{t.pattern}{t.match && ` · 🔍 ${t.match.query} (${t.match.label})`}{t.inspired_by && <> · inspired by <a href={t.inspired_url ?? undefined} target="_blank" rel="noreferrer">{t.inspired_by}</a>{t.inspired_views && ` (${fmt(t.inspired_views)} views)`}</>}</p>
        {open === t.title && <><Breakdown title={t.title} model={model}/><div className="toolbar-actions"><CopyButton text={t.title}/><Button disabled={!canPlan} title={planTitle} onClick={() => onPlan(t.title, notes(t, s.keyword))}><CalendarPlus size={16} aria-hidden/>Add to Planner</Button></div></>}
      </li>)}</ul>
      <div className="kr-head"><p className="muted kr-note">Click a title to see what moves its score. Edit it to match your video.</p><Button onClick={() => void suggest(true)}>Suggest 5 more</Button></div>
      <div className="kr-research">
        <div>
          <h3>What works for “{s.keyword}”</h3>
          {s.patterns.map(p => <div key={p.name} className="kr-factor"><span>{p.name}</span><span className="kr-bar"><i className="kr-pos" style={{ left: 0, width: `${Math.round(p.share * 100)}%` }}/></span><span>{Math.round(p.share * 100)}%</span></div>)}
          <p className="muted kr-note">Share of views among the {s.studied} top videos studied. A title can use several patterns.</p>
          {s.trending.length > 0 && <><h3>Searching now</h3><p className="kr-chips">{s.trending.map(t => <span key={t.query} className="radar-label">{t.query} · {t.label}</span>)}</p></>}
        </div>
        <div>
          <h3>Most-viewed videos</h3>
          <ul className="radar-evidence">{s.top.map(v => <li key={v.url}><a href={v.url} target="_blank" rel="noreferrer">{v.title}</a> <span className="muted">· {fmt(v.views)} views · {v.age}</span></li>)}</ul>
        </div>
      </div>
    </section>}

    <section className="glass kr-panel">
      <h2>Score your own title</h2>
      <input value={mine} onChange={e => setMine(e.target.value)} placeholder="Type a title" aria-label="Your title" maxLength={120}/>
      {mine.trim() && <><Breakdown title={mine} model={model}/><div className="toolbar-actions"><Button onClick={() => toggle(mine.trim())}><Star size={16} aria-hidden/>{isSaved(mine.trim()) ? 'Saved' : 'Save'}</Button></div></>}
    </section>

    <section className="glass kr-panel">
      <h2><Star size={18} weight="fill" aria-hidden/> Saved titles <span className="muted">({list.length})</span></h2>
      {!list.length ? <p className="muted">Star a title to keep it here. Saved in this browser only.</p>
        : <ul className="kr-titles">{list.map(r => <li key={r.title}><div className="kr-title-row">
          <span className="kr-title">{r.title}{r.keyword && <span className="muted"> · {r.keyword}</span>}</span>
          <span className={`kr-badge kr-${tone(r.score)}`}>{r.score}</span>
          <CopyButton text={r.title}/>
          <Button disabled={!canPlan} title={planTitle} onClick={() => onPlan(r.title, `Saved title from Title Lab${r.keyword ? ` for “${r.keyword}”` : ''} · score ${r.score}/100.`)}><CalendarPlus size={16} aria-hidden/>Planner</Button>
          <Button aria-label={`Remove ${r.title}`} onClick={() => toggle(r.title)}><X size={16} aria-hidden/></Button>
        </div></li>)}</ul>}
    </section>
  </div>;
}
