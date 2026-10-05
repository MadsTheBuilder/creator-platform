import { useState } from 'react';
import { YoutubeLogo } from '@phosphor-icons/react';
import { Empty, Thumb } from './ui';
import { displayNumber, engagementRate, statistic, type DailyReport } from '../data/youtube-overview';
import type { YouTubeSnapshot } from '../data/youtube';
export function YouTubeOverviewChart({ report, metric, label, source = 'YouTube Analytics' }: { report: DailyReport; metric: string; label?: string; source?: string }) {
  const [inspect, setInspect] = useState(false);
  const name = label ?? (metric === 'views' ? 'Views' : 'Watch time (minutes)');
  const start = Date.parse(`${report.startDate}T00:00:00Z`), end = Date.parse(`${report.endDate}T00:00:00Z`);
  const maximum = Math.max(1, ...report.points.map(p => p.value));
  const points = report.points.map(p => ({ ...p, x: (Date.parse(`${p.date}T00:00:00Z`) - start) / Math.max(86400000, end - start) * 800, y: 130 - p.value / maximum * 115 }));
  return <section className="glass chart live-chart" aria-label={`${name} from ${source}`}>
    <div className="chart-top"><div><h2>{name} over time</h2><div className="chart-total"><strong>{displayNumber(report.total)}</strong></div></div><div className="chart-legend"><span><i className="current-dot" />{source}</span><span>{report.startDate} – {report.endDate}</span></div></div>
    {report.total === null ? <p className="live-chart-message">This metric is unavailable for the selected period.</p> : !points.length ? <p className="live-chart-message">No daily activity rows were returned for this period. The report total is 0.</p> : <svg className="plot" viewBox="0 0 800 145" preserveAspectRatio="none" role="img" aria-label={`${name}: ${displayNumber(report.total)}. ${points.length} reported daily observations.`}>{points.map((p, i) => <g key={p.date}>{i > 0 && Date.parse(p.date) - Date.parse(points[i - 1].date) === 86400000 && <path d={`M ${points[i - 1].x} ${points[i - 1].y} L ${p.x} ${p.y}`} className="current-curve" />}<line x1={p.x} y1={p.y} x2={p.x} y2={p.y} className="point"><title>{p.date}: {p.value}</title></line></g>)}</svg>}
    <div className="chart-dates"><span>{report.startDate}</span><span>{report.endDate}</span><button className="chart-data-button" onClick={() => setInspect(!inspect)} aria-expanded={inspect}>Data</button></div>
    <p className="live-chart-note">Complete UTC days · {source} reporting can lag. Previous-period comparison is unavailable.</p>
    {points.length > 0 && <p className="live-chart-note">{points.length} reported days · Latest reported day: {points[points.length - 1].date}. Unreported days are not filled in.</p>}
    {inspect && <div className="chart-data table-scroll"><table><caption>{name} · reported observations only</caption><thead><tr><th scope="col">UTC date</th><th scope="col">{name}</th></tr></thead><tbody>{report.points.map(p => <tr key={p.date}><td>{p.date}</td><td>{displayNumber(p.value)}</td></tr>)}</tbody></table>{!report.points.length && <p>No daily observations available.</p>}</div>}
  </section>;
}
const clock = (seconds?: number) => { if (typeof seconds !== 'number') return 'Unavailable'; const t = Math.round(seconds); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const analyticsRows: [string, string, (v?: number) => string][] = [
  ['Watch time (minutes)', 'estimatedMinutesWatched', v => displayNumber(v ?? null)], ['Avg. view duration', 'averageViewDuration', clock],
  ['Avg. percentage viewed', 'averageViewPercentage', v => typeof v === 'number' ? `${v.toFixed(1)}%` : 'Unavailable'], ['Shares', 'shares', v => displayNumber(v ?? null)],
  ['Subscribers gained', 'subscribersGained', v => displayNumber(v ?? null)],
];
export function YouTubeUploads({ videos, search }: { videos: YouTubeSnapshot['videos']; search: string }) {
  const [selected, setSelected] = useState(''), [sort, setSort] = useState('newest');
  const filtered = videos.filter(v => v.title.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => sort === 'views' ? (statistic(b.statistics, 'viewCount') ?? -1) - (statistic(a.statistics, 'viewCount') ?? -1) : b.publishedAt.localeCompare(a.publishedAt));
  const video = filtered.find(v => v.id === selected) ?? filtered[0];
  const count = (key: string) => video ? statistic(video.statistics, key) : null;
  return <div className="workspace-columns live-content"><section aria-label="Recent YouTube uploads"><div className="section-toolbar"><h2>Recent uploads</h2><div className="toolbar-actions"><label className="sort"><span className="sr-only">Sort uploads</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest first</option><option value="views">Lifetime views</option></select></label></div></div><p className="muted live-upload-note">Up to 10 recent uploads · counters are lifetime totals, independent of the report period.</p>
    {!filtered.length ? <div className="glass"><Empty title={videos.length ? 'No matching uploads' : 'No accessible uploads'} body={videos.length ? 'Try another search.' : 'YouTube returned no accessible recent uploads for this channel.'} /></div> : <div className="ig-post-grid wide">{filtered.map(v => <button key={v.id} className={`glass ig-post ${video?.id === v.id ? 'selected' : ''}`} aria-pressed={video?.id === v.id} onClick={() => setSelected(v.id)}><Thumb src={v.thumbnail} alt={`${v.title} thumbnail`} icon={YoutubeLogo} size={32} className="thumb-wide" /><span><strong>{v.title}</strong><small>{new Date(v.publishedAt).toLocaleDateString()}</small><small>{displayNumber(statistic(v.statistics, 'viewCount'))} views · {displayNumber(statistic(v.statistics, 'likeCount'))} likes</small></span></button>)}</div>}
  </section>{video && <aside className="glass live-video-detail" aria-label="Selected YouTube upload"><Thumb src={video.thumbnail} alt={`${video.title} thumbnail`} icon={YoutubeLogo} size={48} className="thumb-wide" /><h2>{video.title}</h2><p className="muted">Published {new Date(video.publishedAt).toLocaleString()}</p>
    <dl>{[['Views', 'viewCount'], ['Likes', 'likeCount'], ['Comments', 'commentCount']].map(([label, key]) => <div key={key}><dt>{label} · lifetime</dt><dd>{displayNumber(count(key))}</dd></div>)}<div><dt>Engagement rate</dt><dd>{engagementRate(count('viewCount'), count('likeCount'), count('commentCount'))}</dd></div>
      {video.insights && analyticsRows.map(([label, key, format]) => <div key={key}><dt>{label}</dt><dd>{format(video.insights![key])}</dd></div>)}</dl>
    <p className="muted">{video.insights ? 'Watch time, retention, shares and subscribers come from YouTube Analytics since publishing, through the latest complete day.' : 'YouTube Analytics hasn’t reported insights for this upload yet.'} Engagement rate is likes and comments per view.</p>
    <a className="button primary" href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`} target="_blank" rel="noreferrer">Watch on YouTube</a><p className="muted">Source: YouTube Data API &amp; YouTube Analytics</p></aside>}</div>;
}
