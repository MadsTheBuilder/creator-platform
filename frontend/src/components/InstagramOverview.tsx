import { useEffect, useRef, useState } from 'react';
import { InstagramLogo, Users, Eye, Broadcast, Heart, ChatCircle } from '@phosphor-icons/react';
import { supabase } from '../data/supabase';
import { socialMessages, socialRequest } from '../data/social';
import type { InstagramDay, InstagramMedia, InstagramSnapshot, SocialStatus } from '../data/social';
import { displayNumber, type DailyReport } from '../data/youtube-overview';
import { YouTubeOverviewChart } from './YouTubeOverview';
import { Button, Empty, Thumb } from './ui';

type DailyMetric = Exclude<keyof InstagramDay, 'date'>;

// Sums reported values; null when nothing was reported (never invent zeros).
export function totalOf(values: (number | null | undefined)[]): number | null {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
export function dailySeries(insights: InstagramSnapshot['insights'], metric: DailyMetric): DailyReport {
  const points = insights.days.flatMap(d => typeof d[metric] === 'number' ? [{ date: d.date, value: d[metric] as number }] : []);
  return { startDate: insights.startDate, endDate: insights.endDate, points, total: totalOf(points.map(p => p.value)) };
}
const seconds = (ms: number | null | undefined) => typeof ms === 'number' ? `${(ms / 1000).toFixed(1)}s` : '—';
const detailRows: [string, string, 'ms'?][] = [
  ['Views', 'views'], ['Reach', 'reach'], ['Likes', 'likes'], ['Comments', 'comments'], ['Replies', 'replies'], ['Shares', 'shares'], ['Saves', 'saved'],
  ['Total interactions', 'total_interactions'], ['Avg. watch time', 'ig_reels_avg_watch_time', 'ms'], ['Total watch time', 'ig_reels_video_view_total_time', 'ms'],
  ['Follows', 'follows'], ['Profile visits', 'profile_visits'],
];

const IgThumb = ({ media, size }: { media: InstagramMedia; size: number }) => <Thumb src={media.thumbnail} alt={`${media.title} thumbnail`} icon={InstagramLogo} size={size} />;

export function InstagramOverview({ search, onConnections }: { search: string; onConnections: () => void }) {
  const [snapshot, setSnapshot] = useState<InstagramSnapshot | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [selected, setSelected] = useState('');
  const [metric, setMetric] = useState<DailyMetric>('views');
  const generation = useRef(0);
  async function refresh() {
    const id = ++generation.current;
    setBusy(true); setError(''); setSnapshot(null);
    try {
      const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
      if (!data.session) throw new Error(socialMessages.sign_in_required);
      const status = await socialRequest<SocialStatus>('instagram', 'status');
      if (!status.configured) throw new Error(socialMessages.setup_required);
      if (!status.connected) throw new Error(socialMessages.not_connected);
      const next = await socialRequest<InstagramSnapshot>('instagram', 'sync');
      if (id === generation.current) setSnapshot(next);
    } catch (cause) {
      if (id === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load Instagram data.');
    } finally { if (id === generation.current) setBusy(false); }
  }
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, []);

  const stats = snapshot?.account.statistics, insights = snapshot?.insights;
  const period = (m: DailyMetric) => insights ? dailySeries(insights, m).total : null;
  const net = insights && insights.follows !== null && insights.unfollows !== null ? insights.follows - insights.unfollows : null;
  const metrics: { name: string; icon: typeof Eye; value: number | null; unit: string; key?: DailyMetric }[] = [
    { name: 'Followers', icon: Users, value: stats?.followers ?? null, unit: net === null ? 'Current total' : `${net >= 0 ? '+' : ''}${net.toLocaleString()} net · last 28 days` },
    { name: 'Views', icon: Eye, value: period('views'), unit: 'Last 28 days', key: 'views' },
    { name: 'Reach', icon: Broadcast, value: period('reach'), unit: 'Sum of daily reach', key: 'reach' },
    { name: 'Likes', icon: Heart, value: period('likes'), unit: 'Last 28 days', key: 'likes' },
    { name: 'Comments', icon: ChatCircle, value: period('comments'), unit: 'Last 28 days', key: 'comments' },
  ];
  const posts = (snapshot?.videos ?? []).filter(p => p.title.toLowerCase().includes(search.trim().toLowerCase()));
  const all = [...(snapshot?.stories ?? []), ...(snapshot?.videos ?? [])];
  const current = all.find(p => p.id === selected) ?? posts[0];
  const isStory = !!snapshot?.stories?.some(s => s.id === current?.id);

  return <>
    {error && <div className="glass live-status" role="alert"><p>{error}</p><Button onClick={onConnections}>View connections</Button><Button disabled={busy} onClick={() => void refresh()}>Retry</Button></div>}
    {!snapshot ? <div className="glass" aria-busy={busy}><Empty title={busy ? 'Loading your Instagram account' : 'Connect your Instagram account'} body={busy ? 'Fetching your profile, insights, stories and recent posts.' : 'Connect an owned Business or Creator account to see real performance data.'}>{!busy && <Button className="primary" onClick={onConnections}>View connections</Button>}</Empty></div> : <>
      <div className="live-channel"><div className="ig-profile">{snapshot.account.picture ? <img src={snapshot.account.picture} alt="" referrerPolicy="no-referrer" /> : <InstagramLogo size={40} />}<div><h2>@{snapshot.account.title}</h2><p>{displayNumber(stats?.followers ?? null)} followers · {displayNumber(stats?.following ?? null)} following · {displayNumber(stats?.posts ?? null)} posts</p><p>{snapshot.source} · Fetched {new Date(snapshot.observedAt).toLocaleString()}</p></div></div><div className="toolbar-actions"><Button disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh data'}</Button><Button onClick={onConnections}>Manage connection</Button></div></div>
      <div className="metric-grid ig-metrics">{metrics.map(m => m.key ? <button className="glass metric" key={m.name} aria-pressed={metric === m.key} onClick={() => setMetric(m.key!)}><m.icon size={25} /><span><small>{m.name}</small><span className="metric-value"><strong>{displayNumber(m.value)}</strong></span><small>{m.unit}</small></span></button> : <div className="glass metric" key={m.name}><m.icon size={25} /><span><small>{m.name}</small><span className="metric-value"><strong>{displayNumber(m.value)}</strong></span><small>{m.unit}</small></span></div>)}</div>
      <YouTubeOverviewChart report={dailySeries(snapshot.insights, metric)} metric={metric} label={metrics.find(m => m.key === metric)?.name ?? 'Views'} source="Instagram Insights" />

      <section className="ig-stories" aria-label="Active Instagram stories"><div className="section-toolbar"><h2>Stories</h2></div>
        <p className="muted live-upload-note">Active stories only. Instagram keeps story insights for 24 hours, and stories with fewer than 5 views return no numbers.</p>
        {snapshot.stories === null ? <p className="muted">Stories could not be loaded from Instagram.</p> : !snapshot.stories.length ? <p className="muted">No active stories in the last 24 hours.</p> :
          <div className="ig-story-row">{snapshot.stories.map(s => <button key={s.id} className={`ig-story ${current?.id === s.id ? 'selected' : ''}`} aria-pressed={current?.id === s.id} onClick={() => setSelected(s.id)}><IgThumb media={s} size={24} /><small>{displayNumber(s.statistics.views ?? null)} views</small></button>)}</div>}
      </section>

      <div className="workspace-columns live-content"><section aria-label="Recent Instagram posts"><div className="section-toolbar"><h2>Recent posts &amp; reels</h2></div><p className="muted live-upload-note">Lifetime numbers per post. Instagram can take up to 48 hours to report insights.</p>
        {!posts.length ? <div className="glass"><Empty title={snapshot.videos.length ? 'No matching posts' : 'No accessible posts'} body={snapshot.videos.length ? 'Try another search.' : 'Instagram returned no recent posts for this account.'} /></div> : <div className="ig-post-grid">{posts.map(p => <button key={p.id} className={`glass ig-post ${current?.id === p.id ? 'selected' : ''}`} aria-pressed={current?.id === p.id} onClick={() => setSelected(p.id)}><IgThumb media={p} size={32} /><span><strong>{p.title}</strong>{p.publishedAt && <small>{new Date(p.publishedAt).toLocaleDateString()}</small>}<small>{displayNumber(p.statistics.views ?? null)} views · {displayNumber(p.statistics.likes ?? null)} likes</small></span></button>)}</div>}
      </section>{current && <aside className="glass live-video-detail" aria-label={`Selected Instagram ${isStory ? 'story' : 'post'}`}><IgThumb media={current} size={48} /><h2>{isStory ? 'Story' : current.title} insights</h2>{current.publishedAt && <p className="muted">Published {new Date(current.publishedAt).toLocaleString()}</p>}
        <dl>{detailRows.filter(([, key]) => key in current.statistics).map(([label, key, unit]) => <div key={key}><dt>{label}</dt><dd>{unit === 'ms' ? seconds(current.statistics[key]) : displayNumber(current.statistics[key] ?? null)}</dd></div>)}</dl>
        {Object.entries(current.statistics).every(([k, v]) => v === null || k === 'likes' || k === 'comments') && <p className="muted">Instagram hasn’t reported insights for this {isStory ? 'story' : 'post'} yet.</p>}
        {current.url && <a className="button primary" href={current.url} target="_blank" rel="noreferrer">Open on Instagram</a>}<p className="muted">Source: Instagram Insights</p></aside>}</div>
    </>}
  </>;
}
