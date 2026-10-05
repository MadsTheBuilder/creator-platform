import { useState } from 'react';
import { YoutubeLogo, InstagramLogo, TiktokLogo, ChartBar, Clock, Users, Timer, CalendarBlank } from '@phosphor-icons/react';
import { Button, Empty, Notice } from '../components/ui';
import { useYouTubeOverview } from '../data/useYouTubeOverview';
import { reportSeries, statistic, displayNumber } from '../data/youtube-overview';
import { YouTubeOverviewChart, YouTubeUploads } from '../components/YouTubeOverview';
import { connectorMessages } from '../data/youtube';
import { InstagramOverview } from '../components/InstagramOverview';
import { TikTokOverview } from '../components/TikTokOverview';

const platforms = [{ name: 'YouTube', icon: YoutubeLogo }, { name: 'Instagram', icon: InstagramLogo }, { name: 'TikTok', icon: TiktokLogo }] as const;
type Platform = typeof platforms[number]['name'];
export function Overview({ search, onConnections }: { search: string; onConnections: () => void }) {
  const [platform, setPlatform] = useState<Platform>('YouTube');
  const [days, setDays] = useState(28);
  const [metric, setMetric] = useState<'views' | 'estimatedMinutesWatched'>('views');
  const { snapshot, busy, error, refresh } = useYouTubeOverview();
  const views = snapshot ? reportSeries(snapshot, days, 'views') : null;
  const watch = snapshot ? reportSeries(snapshot, days, 'estimatedMinutesWatched') : null;
  const metrics = [
    { name: 'Views', icon: ChartBar, value: views?.total ?? null, unit: `Last ${days} complete UTC days`, key: 'views' as const },
    { name: 'Watch time', icon: Clock, value: watch?.total ?? null, unit: 'Minutes · selected period', key: 'estimatedMinutesWatched' as const },
    { name: 'Subscribers', icon: Users, value: snapshot && !snapshot.channel.statistics.hiddenSubscriberCount ? statistic(snapshot.channel.statistics, 'subscriberCount') : null, unit: snapshot?.channel.statistics.hiddenSubscriberCount ? 'Hidden by channel' : 'Current channel total' },
    { name: 'Retention', icon: Timer, value: null, unit: 'Not available from this connector' },
  ];
  return <div className="live-overview">
    <div className="platform-toolbar"><div className="platform-tabs" aria-label="Platform">{platforms.map(p => <button key={p.name} className={platform === p.name ? 'active' : ''} aria-pressed={platform === p.name} onClick={() => setPlatform(p.name)}><p.icon size={21} />{p.name}</button>)}</div>
      {platform === 'YouTube' && <div className="period-controls"><label><CalendarBlank size={21} /><span className="sr-only">Analysis period</span><select value={days} onChange={e => setDays(Number(e.target.value))}><option value={28}>Last 28 days</option><option value={7}>Last 7 days</option></select></label><Button disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh data'}</Button></div>}
    </div>
    {platform === 'TikTok' ? <TikTokOverview search={search} onConnections={onConnections} /> : platform === 'Instagram' ? <InstagramOverview search={search} onConnections={onConnections} /> : <>
      {error && <div className="glass live-status" role="alert"><p>{error}</p><Button onClick={onConnections}>View connections</Button><Button disabled={busy} onClick={() => void refresh()}>Retry</Button></div>}
      {!snapshot ? <div className="glass" aria-busy={busy}><Empty title={busy ? 'Loading your YouTube channel' : 'Connect your YouTube channel'} body={busy ? 'Fetching channel statistics, recent uploads and the latest available report.' : 'Sign in and connect an owned channel to see real performance data.'}>{!busy && <Button className="primary" onClick={onConnections}>View connections</Button>}</Empty></div> : <>
        <div className="live-channel"><div className="ig-profile">{snapshot.channel.picture ? <img src={snapshot.channel.picture} alt="" referrerPolicy="no-referrer" /> : <YoutubeLogo size={40} />}<div><h2>{snapshot.channel.title}</h2><p>{snapshot.channel.statistics.hiddenSubscriberCount ? 'Subscribers hidden' : `${displayNumber(statistic(snapshot.channel.statistics, 'subscriberCount'))} subscribers`} · {displayNumber(statistic(snapshot.channel.statistics, 'videoCount'))} videos · {displayNumber(statistic(snapshot.channel.statistics, 'viewCount'))} lifetime views</p><p>YouTube APIs · Fetched {new Date(snapshot.observedAt).toLocaleString()}</p></div></div><Button onClick={onConnections}>Manage connection</Button></div>
        {snapshot.analyticsError && <Notice>{connectorMessages[snapshot.analyticsError] ?? 'Analytics are unavailable.'} Channel and upload counters are still available.</Notice>}
        <div className="metric-grid">{metrics.map(m => m.key ? <button className="glass metric" key={m.name} aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}><m.icon size={25} /><span><small>{m.name}</small><span className="metric-value"><strong>{displayNumber(m.value)}</strong></span><small>{m.unit}</small></span></button> : <div className="glass metric" key={m.name}><m.icon size={25} /><span><small>{m.name}</small><span className="metric-value"><strong>{displayNumber(m.value)}</strong></span><small>{m.unit}</small></span></div>)}</div>
        <YouTubeOverviewChart report={reportSeries(snapshot, days, metric)} metric={metric} />
        <YouTubeUploads videos={snapshot.videos} search={search} />
      </>}
    </>}
  </div>;
}
