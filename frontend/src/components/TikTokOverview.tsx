import { useState } from 'react';
import { TiktokLogo, Eye, Heart, ChatCircle, ShareNetwork } from '@phosphor-icons/react';
import { useTikTokOverview } from '../data/useTikTokOverview';
import { inventoryTotal, videoCounter, visibleTikTokVideos, type TikTokMetric, type TikTokVideo } from '../data/tiktok-overview';
import { displayNumber, engagementRate } from '../data/youtube-overview';
import { Button, Empty, Notice, Thumb } from './ui';

const metrics = [{ key: 'views', name: 'Views', icon: Eye }, { key: 'likes', name: 'Likes', icon: Heart }, { key: 'comments', name: 'Comments', icon: ChatCircle }, { key: 'shares', name: 'Shares', icon: ShareNetwork }] as const;

export function TikTokInventory({ videos, search }: { videos: TikTokVideo[]; search: string }) {
  const [selected, setSelected] = useState(''), [sort, setSort] = useState('newest');
  const filtered = visibleTikTokVideos(videos, search, sort);
  const video = filtered.find(v => v.id === selected) ?? filtered[0];
  return <div className="workspace-columns live-content"><section aria-label="Recent TikTok videos">
    <div className="section-toolbar"><h2>Recent public videos</h2><div className="toolbar-actions"><label className="sort"><span className="sr-only">Sort TikTok videos</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest first</option><option value="views">Lifetime views</option></select></label></div></div>
    <p className="muted live-upload-note">Up to 10 recent public videos. Counters are lifetime totals for each video.</p>
    {!filtered.length ? <div className="glass"><Empty title={videos.length ? 'No matching videos' : 'No accessible public videos'} body={videos.length ? 'Try another search.' : 'TikTok returned no recent public videos. Private videos are not included.'} /></div> : <div className="ig-post-grid">{filtered.map(v => <button key={v.id} className={`glass ig-post ${video?.id === v.id ? 'selected' : ''}`} aria-pressed={video?.id === v.id} onClick={() => setSelected(v.id)}><Thumb src={v.thumbnail} alt={`${v.title} cover`} icon={TiktokLogo} size={32} className="thumb-tall" /><span><strong>{v.title}</strong>{v.publishedAt && <small>{new Date(v.publishedAt).toLocaleDateString()}</small>}<small>{displayNumber(videoCounter(v, 'views'))} lifetime views · {displayNumber(videoCounter(v, 'likes'))} likes</small></span></button>)}</div>}
  </section>{video && <aside className="glass live-video-detail" aria-label="Selected TikTok video"><Thumb src={video.thumbnail} alt={`${video.title} cover`} icon={TiktokLogo} size={48} className="thumb-tall" /><h2>{video.title}</h2>{video.publishedAt && <p className="muted">Published {new Date(video.publishedAt).toLocaleString()}</p>}
    <dl>{metrics.map(m => <div key={m.key}><dt>{m.name} · lifetime</dt><dd>{displayNumber(videoCounter(video, m.key))}</dd></div>)}<div><dt>Engagement rate</dt><dd>{engagementRate(videoCounter(video, 'views'), videoCounter(video, 'likes'), videoCounter(video, 'comments'), videoCounter(video, 'shares'))}</dd></div></dl>
    <p className="muted">Engagement rate is likes, comments and shares per view. Watch time and retention are unavailable from this connection.</p>{video.url && <a className="button primary" href={video.url} target="_blank" rel="noreferrer">Open on TikTok</a>}<p className="muted">Source: TikTok Display API</p></aside>}</div>;
}

export function TikTokOverview({ search, onConnections }: { search: string; onConnections: () => void }) {
  const { snapshot, busy, error, refresh } = useTikTokOverview();
  const [metric, setMetric] = useState<TikTokMetric>('views');
  const ranked = snapshot ? visibleTikTokVideos(snapshot.videos, '', 'newest').filter(v => videoCounter(v, metric) !== null).sort((a, b) => videoCounter(b, metric)! - videoCounter(a, metric)!) : [];
  const max = Math.max(1, ...ranked.map(v => videoCounter(v, metric)!));
  return <>
    {error && <div className="glass live-status" role="alert"><p>{error}</p><Button onClick={onConnections}>View connections</Button><Button disabled={busy} onClick={() => void refresh()}>Retry</Button></div>}
    {!snapshot ? <div className="glass" aria-busy={busy}><Empty title={busy ? 'Loading your TikTok account' : 'TikTok data unavailable'} body={busy ? 'Fetching your profile and recent public videos.' : 'Check your connection or retry loading your account.'}>{!busy && <Button onClick={onConnections}>View connections</Button>}</Empty></div> : <>
      <div className="live-channel"><div className="ig-profile">{snapshot.account.picture ? <img src={snapshot.account.picture} alt="" referrerPolicy="no-referrer" /> : <TiktokLogo size={40} />}<div><h2>{snapshot.account.title}</h2><p>{snapshot.videos.length} recent public videos returned</p><p>{snapshot.source} · Fetched {new Date(snapshot.observedAt).toLocaleString()}</p></div></div><div className="toolbar-actions"><Button disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh data'}</Button><Button onClick={onConnections}>Manage connection</Button></div></div>
      <Notice>Totals cover the returned videos, not your entire account or a date range. Followers, daily activity, growth comparisons, watch time and retention are unavailable with this connection.</Notice>
      <div className="metric-grid">{metrics.map(m => { const total = inventoryTotal(snapshot.videos, m.key); return <button key={m.key} className="glass metric" aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}><m.icon size={25} /><span><small>{m.name}</small><span className="metric-value"><strong>{displayNumber(total.value)}</strong></span><small>Lifetime · {total.reported}/{total.count} videos reporting</small></span></button>; })}</div>
      <section className="glass tt-ranking" aria-label="TikTok video comparison"><h2>{metrics.find(m => m.key === metric)?.name} by video</h2><p className="muted">Lifetime counters · recent public videos only</p>{!ranked.length ? <p className="muted">No reported values to compare.</p> : <ol>{ranked.map(v => <li key={v.id}><span>{v.title}</span><strong>{displayNumber(videoCounter(v, metric))}</strong><meter min={0} max={max} value={videoCounter(v, metric)!} aria-label={`${v.title}: ${videoCounter(v, metric)} ${metric}`} /></li>)}</ol>}</section>
      <TikTokInventory videos={snapshot.videos} search={search} />
    </>}
  </>;
}
