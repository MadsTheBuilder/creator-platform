import { useEffect, useRef, useState } from 'react';
import { supabase } from '../data/supabase';
import { socialMessages, socialRequest } from '../data/social';
import type { SocialProvider, SocialSnapshot, SocialStatus } from '../data/social';
import { Button, Notice } from './ui';
import { connectionIdentityChanged } from '../data/connection-session';
export function SocialConnection({provider}:{provider:SocialProvider}) {
  const name = provider === 'tiktok' ? 'TikTok' : 'Instagram';
  const [status,setStatus] = useState<SocialStatus|null>(null);
  const [snapshot,setSnapshot] = useState<SocialSnapshot|null>(null);
  const [signedIn,setSignedIn] = useState(false);
  const [busy,setBusy] = useState(true);
  const [error,setError] = useState('');
  const generation = useRef(0);
  const identity = useRef<string | null | undefined>(undefined);
  const [retry,setRetry] = useState(0);
  const result = new URLSearchParams(window.location.search).get(provider);
  useEffect(()=>{
    let active = true;
    async function load() {
      const id = ++generation.current;
      setBusy(true);setSnapshot(null);setStatus(null);setError('');setSignedIn(false);
      try {
        const {data} = supabase ? await supabase.auth.getSession() : {data:{session:null}};
        if (!active || id !== generation.current) return;
        identity.current = data.session?.user.id ?? null;
        setSignedIn(!!data.session);
        if (data.session) {
          const next = await socialRequest<SocialStatus>(provider,'status');
          if (active && id === generation.current) setStatus(next);
        }
      } catch(cause) {if (active && id === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load connection.');}
      finally {if (active && id === generation.current) setBusy(false);}
    }
    void load();
    const subscription = supabase?.auth.onAuthStateChange((_event,session)=>{
      const nextIdentity = session?.user.id ?? null;
      if (!connectionIdentityChanged(identity.current,nextIdentity)) return;
      identity.current = nextIdentity;
      generation.current++; setSnapshot(null);setStatus(null);setSignedIn(false);setBusy(true);
      setTimeout(()=>{if(active) void load();},0);
    }).data.subscription;
    return ()=>{active=false;generation.current++;subscription?.unsubscribe();};
  },[provider,retry]);
  async function perform(action:'start'|'sync'|'disconnect') {
    const id = generation.current;
    setBusy(true);setError('');
    try {
      if (action === 'start') {
        const next = await socialRequest<{url:string}>(provider,action);
        const url = new URL(next.url);
        const expected = provider === 'tiktok' ? 'www.tiktok.com' : 'www.instagram.com';
        if (url.protocol !== 'https:' || url.hostname !== expected || url.username || url.password) throw new Error('Invalid provider authorization URL.');
        if (id === generation.current) window.location.assign(url.href);
      } else if (action === 'sync') {
        setSnapshot(null);
        const next = await socialRequest<SocialSnapshot>(provider,action);
        if (id === generation.current) setSnapshot(next);
      } else {
        const next = await socialRequest<{revoked:boolean}>(provider,action);
        if (id === generation.current) {
          setSnapshot(null);setStatus(previous=>previous ? {...previous,connected:false,account:null} : null);
          if (!next.revoked) setError(`Disconnected from Creator OS. Remove Creator OS access in your ${name} account settings to revoke the provider grant.`);
        }
      }
    } catch(cause) {if(id===generation.current) setError(cause instanceof Error ? cause.message : 'The request failed. Try again.');}
    finally {if(id===generation.current) setBusy(false);}
  }
  return <section className="glass connection-detail" aria-label={`${name} connection`}>
    <h2>{name}</h2><p>Connect your owned account to load real content and native engagement.</p>
    {result && <p role="status">{socialMessages[result] ?? `${name} connection did not complete. Check app configuration and try again.`}</p>}
    {!signedIn && !busy && <Notice>Sign in to Creator OS above, then connect {name}.</Notice>}
    {signedIn && status && !status.configured && <Notice>{name} app setup is pending. {provider === 'instagram' ? 'Add the Instagram app ID, app secret and supported Graph API version on the backend.' : 'Add TikTok Login Kit credentials on the backend.'}</Notice>}
    {provider === 'instagram' && <p className="muted">Requires an Instagram Business or Creator account and an app configured for Instagram Login. Personal accounts are not supported.</p>}
    {busy && <p role="status">Checking {name}…</p>}
    {status?.connected && <p>Connected: <strong>{status.account?.title}</strong></p>}
    <div className="youtube-actions">
      <Button className="primary" disabled={busy || !signedIn || status?.configured === false} onClick={()=>void perform('start')}>{status?.connected ? `Reconnect ${name}` : `Connect ${name}`}</Button>
      {signedIn && !status && !busy && <Button onClick={()=>setRetry(value=>value+1)}>Retry connection check</Button>}
      {status?.connected && <><Button disabled={busy} onClick={()=>void perform('sync')}>Refresh account data</Button><Button disabled={busy} onClick={()=>void perform('disconnect')}>Disconnect</Button></>}
    </div>
    {error && <p role="alert">{error}</p>}
    {signedIn && !status && !busy && <p className="muted">The connection check could not finish. Retry it, or use Connect to start authorization.</p>}
    <p className="muted">Read-only access to your profile and content. No posting or messaging permissions.</p>
    {snapshot && <div aria-label={`Live ${name} data`}><h3>{snapshot.account.title}</h3><p>{snapshot.source} · Fetched {new Date(snapshot.observedAt).toLocaleString()}</p><h3>Up to 10 recent {provider === 'tiktok' ? 'public videos' : 'posts'}</h3>
      <p className="muted">Counters describe each post’s native engagement. Watch time, retention and period comparisons are unavailable.</p>
      {snapshot.videos.length ? <ul>{snapshot.videos.map(video=><li key={video.id}>
        {video.url ? <a href={video.url} target="_blank" rel="noreferrer">{video.title}</a> : <strong>{video.title}</strong>}
        {video.publishedAt && <p>Published {new Date(video.publishedAt).toLocaleString()}</p>}
        <p>{Object.entries(video.statistics).map(([metric,value])=>`${metric}: ${value === null ? 'Unavailable' : value.toLocaleString()}`).join(' · ')}</p>
      </li>)}</ul> : <p>No accessible content was returned.</p>}
    </div>}
  </section>;
}
