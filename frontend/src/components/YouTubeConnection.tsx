import { useEffect, useRef, useState } from 'react';
import { supabase } from '../data/supabase';
import { connectorMessages, youtubeRequest } from '../data/youtube';
import type { YouTubeSnapshot, YouTubeStatus } from '../data/youtube';
import { Button, Notice } from './ui';

export function YouTubeConnection() {
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  const [snapshot, setSnapshot] = useState<YouTubeSnapshot | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const result = new URLSearchParams(window.location.search).get('youtube');
  useEffect(() => {
    let active = true;
    const client = supabase;
    async function load() {
      const id = ++generation.current;
      setSnapshot(null); setStatus(null); setError('');
      try {
        const { data } = client ? await client.auth.getSession() : { data: { session: null } };
        if (!active || id !== generation.current) return;
        setSignedIn(!!data.session);
        if (data.session) {
          const next = await youtubeRequest<YouTubeStatus>('status');
          if (active && id === generation.current) setStatus(next);
        }
      } catch (cause) { if (active && id === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load connection.'); }
      finally { if (active && id === generation.current) setBusy(false); }
    }
    void load();
    const subscription = client?.auth.onAuthStateChange(() => { setTimeout(() => { if (active) { setBusy(true); void load(); } }, 0); }).data.subscription;
    return () => { active = false; generation.current++; subscription?.unsubscribe(); };
  }, []);
  async function perform(action: 'start' | 'sync' | 'disconnect') {
    const id = generation.current;
    setBusy(true); setError('');
    try {
      if (action === 'start') {
        const next = await youtubeRequest<{ url: string }>('start');
        if (id === generation.current) window.location.assign(next.url);
      } else if (action === 'sync') {
        const data = await youtubeRequest<YouTubeSnapshot>('sync');
        if (id === generation.current) setSnapshot(data);
      } else {
        const next = await youtubeRequest<{ revoked: boolean }>('disconnect');
        if (id === generation.current) {
          setStatus(previous => previous ? { ...previous, connected: false, channel: null } : null); setSnapshot(null);
          if (!next.revoked) setError('Disconnected here. Google could not confirm revocation; you can remove access in your Google account permissions.');
        }
      }
    } catch (cause) { if (id === generation.current) setError(cause instanceof Error ? cause.message : 'The request failed. Please try again.'); }
    finally { if (id === generation.current) setBusy(false); }
  }
  const total = (metric: string) => {
    const index = snapshot?.analytics?.columnHeaders?.findIndex(header => header.name === metric) ?? -1;
    return index < 0 ? 'Unavailable' : (snapshot?.analytics?.rows ?? []).reduce((sum, row) => sum + Number(row[index]), 0).toLocaleString();
  };
  return <section className="glass connection-detail" aria-label="YouTube connection">
    <h2>YouTube</h2><p>Connect your owned channel to inspect real videos and performance.</p>
    {result && <p role="status">{connectorMessages[result] ?? 'YouTube setup did not complete. Please try again.'}</p>}
    {!signedIn && !busy && <Notice>Sign in to Creator OS above, then connect your YouTube channel.</Notice>}
    {signedIn && status && !status.configured && <Notice>YouTube is awaiting Google API configuration. Your Creator OS sign-in is ready.</Notice>}
    {busy && <p role="status">Checking YouTube…</p>}
    {status?.connected && <p>Connected: <strong>{status.channel?.title}</strong></p>}
    <div className="youtube-actions">
      <Button className="primary" disabled={busy || !signedIn || !status?.configured} onClick={() => void perform('start')}>{status?.connected ? 'Reconnect YouTube' : 'Connect YouTube'}</Button>
      {status?.connected && <><Button disabled={busy} onClick={() => void perform('sync')}>Refresh channel data</Button><Button disabled={busy} onClick={() => void perform('disconnect')}>Disconnect</Button></>}
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="muted">Read-only access. No posting or Gmail permissions. Choose the Google or Brand account that owns your channel.</p>
    {snapshot && <div aria-label="Live YouTube data">
      <h3>{snapshot.channel.title}</h3><p>YouTube APIs · Fetched {new Date(snapshot.observedAt).toLocaleString()}</p>
      <p>Channel lifetime views: {snapshot.channel.statistics.viewCount === undefined ? 'Unavailable' : Number(snapshot.channel.statistics.viewCount).toLocaleString()} · Subscribers: {snapshot.channel.statistics.hiddenSubscriberCount ? 'Hidden' : snapshot.channel.statistics.subscriberCount === undefined ? 'Unavailable' : Number(snapshot.channel.statistics.subscriberCount).toLocaleString()}</p>
      <h3>Last 28 complete UTC days</h3><p>{snapshot.window.startDate} to {snapshot.window.endDate}. YouTube reporting can lag.</p>
      {snapshot.analyticsError ? <Notice>{connectorMessages[snapshot.analyticsError] ?? 'Analytics are currently unavailable.'} Channel and video data remain available.</Notice> : <p>Views: {total('views')} · Watch time (minutes): {total('estimatedMinutesWatched')}</p>}
      <p className="muted">Retention is unavailable in this connector slice.</p><h3>Up to 10 recent uploads</h3>
      {snapshot.videos.length ? <ul>{snapshot.videos.map(video => <li key={video.id}><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`} target="_blank" rel="noreferrer">{video.title}</a> — {video.statistics.viewCount === undefined ? 'Views unavailable' : `${Number(video.statistics.viewCount).toLocaleString()} lifetime views`}</li>)}</ul> : <p>No accessible uploads were returned.</p>}
    </div>}
  </section>;
}
