import { describe,it,expect } from 'vitest';
import { createConnector, scopes, seal, unseal, reportWindow } from '../../supabase/functions/youtube-connector/core';
import type { Connection, OAuthState, Store } from '../../supabase/functions/youtube-connector/core';

const origin = 'http://127.0.0.1:5173';
const endpoint = 'https://project.supabase.co/functions/v1/youtube-connector';
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const now = Date.parse('2026-09-27T12:00:00Z');
function fixture(options: { scopes?: string[]; noChannel?: boolean; noRefresh?: boolean; refreshFails?: boolean; analyticsFails?: boolean; apiFails?: number; quota?: boolean; timeout?: boolean; configured?: boolean; disconnectDuringRefresh?: boolean } = {}) {
  const connections = new Map<string, Connection>();
  const states = new Map<string, OAuthState>();
  const calls: { url: string; body: string; authorization: string | null }[] = [];
  const store: Store = {
    async get(user) { return connections.get(user) ?? null; },
    async put(connection) { connections.set(connection.user_id, connection); },
    async refresh(connection, previous) { if (connections.get(connection.user_id)?.credentials !== previous) return false; connections.set(connection.user_id, connection); return true; },
    async remove(user) { connections.delete(user); },
    async createState(state) { states.set(state.state_hash, state); },
    async consumeState(hash) { const state = states.get(hash) ?? null; states.delete(hash); return state; },
  };
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? ''), authorization: new Headers(init?.headers).get('Authorization') });
    if (options.timeout) throw new DOMException('Timeout', 'TimeoutError');
    if (url.endsWith('/revoke')) return new Response('{}');
    if (url.endsWith('/token')) {
      const refresh = String(init?.body).includes('grant_type=refresh_token');
      if (refresh && options.disconnectDuringRefresh) connections.delete('user-a');
      if (refresh && options.refreshFails) return Response.json({ error: 'invalid_grant', secret: 'DO_NOT_EXPOSE' }, { status: 400 });
      return Response.json({ access_token: refresh ? 'fresh-access' : 'test-access', expires_in: 3600, scope: (options.scopes ?? scopes).join(' '), ...(options.noRefresh || refresh ? {} : { refresh_token: 'test-refresh' }) });
    }
    if (url.includes('youtubeanalytics')) {
      if (options.analyticsFails) return Response.json({ error: {} }, { status: 403 });
      if (url.includes('dimensions=video')) return Response.json({ columnHeaders: [{ name: 'video' }, { name: 'views' }, { name: 'averageViewDuration' }], rows: [['video-a', 50, 42], ['video-b', -1, 3]] });
      return Response.json({ columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }], rows: [['2026-09-25', 10, 20]] });
    }
    if (options.apiFails) return Response.json({ error: { errors: [{ reason: options.quota ? 'quotaExceeded' : 'forbidden' }], message: 'DO_NOT_EXPOSE' } }, { status: options.apiFails });
    if (url.includes('/channels?')) return Response.json({ items: options.noChannel ? [] : [{ id: 'channel-a', snippet: { title: 'Creator channel' }, statistics: { viewCount: '123', subscriberCount: '12' }, contentDetails: { relatedPlaylists: { uploads: 'uploads-a' } } }] });
    if (url.includes('/playlistItems?')) return Response.json({ items: [{ snippet: { resourceId: { videoId: 'video-a' } } }] });
    if (url.includes('/videos?')) return Response.json({ items: [{ id: 'video-a', snippet: { title: 'Owned upload', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/a/mq.jpg' } } }, statistics: { viewCount: '100' } }] });
    throw new Error('Unexpected provider URL');
  };
  const handle = createConnector({ store, authenticate: async token => token === 'user-a-token' ? 'user-a' : token === 'user-b-token' ? 'user-b' : null, fetch: fakeFetch, clientId: options.configured === false ? '' : 'client-id', clientSecret: 'client-secret', encryptionKey: key, callbackUrl: `${endpoint}?action=callback`, origins: [origin], now: () => now });
  const request = (action: string, token = 'user-a-token', extra = {}, requestOrigin = origin) => handle(new Request(endpoint, { method: 'POST', headers: { Origin: requestOrigin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }));
  async function start() { const response = await request('start'); return new URL((await response.json()).url); }
  async function callback(consent: URL, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ action: 'callback', state: consent.searchParams.get('state')!, code: 'auth-code', ...extra });
    return handle(new Request(`${endpoint}?${params}`));
  }
  async function saved(user = 'user-a', expired = false) {
    connections.set(user, { user_id: user, channel_id: 'channel-a', channel_title: 'Creator channel', credentials: await seal({ access_token: 'saved-access', refresh_token: 'saved-refresh', expires_at: expired ? now - 1 : now + 3600000 }, key, user) });
  }
  return { handle, request, start, callback, saved, calls, connections, states };
}

describe('YouTube consent and account boundaries',()=>{
  it('rejects unsigned and invalid sessions before touching provider APIs',async()=>{const f=fixture();expect((await f.request('start','bad')).status).toBe(401);expect(f.calls).toHaveLength(0);expect(f.states.size).toBe(0);});
  it('rejects unapproved browser origins and CORS preflights',async()=>{const f=fixture();expect((await f.request('start','user-a-token',{},'https://evil.example')).status).toBe(403);expect((await f.handle(new Request(endpoint,{method:'OPTIONS',headers:{Origin:'https://evil.example'}}))).status).toBe(403);});
  it('allows the configured local origin and exact requested headers',async()=>{const f=fixture();const r=await f.handle(new Request(endpoint,{method:'OPTIONS',headers:{Origin:origin}}));expect(r.status).toBe(204);expect(r.headers.get('Access-Control-Allow-Origin')).toBe(origin);});
  it('requests only read-only YouTube scopes, offline access and PKCE',async()=>{const f=fixture();const url=await f.start();expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('scope')?.split(' ')).toEqual(scopes);expect(url.searchParams.get('access_type')).toBe('offline');expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('scope')).not.toMatch(/gmail|upload|force-ssl/);expect([...f.states.values()][0].state_hash).not.toBe(url.searchParams.get('state'));});
  it('stores encrypted credentials, binds the creator, and redirects without tokens',async()=>{const f=fixture();const response=await f.callback(await f.start());expect(response.status).toBe(303);expect(response.headers.get('Location')).toBe(`${origin}/?youtube=connected#connections`);const c=f.connections.get('user-a')!;expect(c.credentials).not.toContain('test-refresh');expect((await unseal(c.credentials,key,'user-a')).refresh_token).toBe('test-refresh');expect(f.calls[0].body).toContain('code_verifier=');});
  it('rejects missing state and callback replay',async()=>{const f=fixture();expect((await f.handle(new Request(`${endpoint}?action=callback&code=x`))).status).toBe(400);const url=await f.start();await f.callback(url);expect((await f.callback(url)).status).toBe(400);expect(f.calls.filter(call=>call.url.endsWith('/token'))).toHaveLength(1);});
  it('rejects expired state before exchanging a code',async()=>{const f=fixture();const url=await f.start();[...f.states.values()][0].expires_at=new Date(now-1).toISOString();expect((await f.callback(url)).status).toBe(400);expect(f.calls).toHaveLength(0);});
  it('treats cancelled consent as a returnable state without creating a connection',async()=>{const f=fixture();const r=await f.callback(await f.start(),{error:'access_denied'});expect(r.headers.get('Location')).toContain('consent_cancelled');expect(f.connections.size).toBe(0);expect(f.calls).toHaveLength(0);});
  it('rejects partial permission grants',async()=>{const f=fixture({scopes:[scopes[0]]});const r=await f.callback(await f.start());expect(r.headers.get('Location')).toContain('missing_permissions');expect(f.connections.size).toBe(0);});
  it('requires renewable access for persistent connections',async()=>{const f=fixture({noRefresh:true});expect((await f.callback(await f.start())).headers.get('Location')).toContain('offline_access_required');expect(f.connections.size).toBe(0);});
  it('handles Google accounts without a channel',async()=>{const f=fixture({noChannel:true});expect((await f.callback(await f.start())).headers.get('Location')).toContain('no_channel');expect(f.connections.size).toBe(0);});
  it('reports missing deployment configuration without creating consent states',async()=>{const f=fixture({configured:false});expect((await f.request('status')).status).toBe(200);expect((await f.request('start')).status).toBe(503);expect(f.states.size).toBe(0);});
  it('ignores forged user IDs and never returns stored credentials in status',async()=>{const f=fixture();await f.saved('user-b');const r=await f.request('status','user-a-token',{user_id:'user-b'});expect((await r.json()).connected).toBe(false);const own=await f.request('status','user-b-token');const body=await own.text();expect(body).toContain('Creator channel');expect(body).not.toContain('credentials');expect(body).not.toContain('saved-refresh');});
});

describe('YouTube refresh, reporting and disconnect',()=>{
  it('fetches owned channel, recent uploads and date-bounded real analytics',async()=>{const f=fixture();await f.saved();const r=await f.request('sync');expect(r.status).toBe(200);const data=await r.json();expect(data.source).toBe('YouTube APIs');expect(data.videos[0].id).toBe('video-a');expect(data.retention).toBeNull();expect(data.videos[0].thumbnail).toBe('https://i.ytimg.com/vi/a/mq.jpg');expect(data.videos[0].insights).toEqual({views:50,averageViewDuration:42});expect(data.window).toEqual({startDate:'2026-08-30',endDate:'2026-09-26'});expect(f.calls.find(c=>c.url.includes('playlistItems'))?.url).toContain('maxResults=10');expect(f.calls.every(c=>c.authorization==='Bearer saved-access')).toBe(true);});
  it('refreshes expired tokens and preserves the existing refresh token',async()=>{const f=fixture();await f.saved('user-a',true);expect((await f.request('sync')).status).toBe(200);expect(f.calls[0].body).toContain('grant_type=refresh_token');const c=await unseal(f.connections.get('user-a')!.credentials,key,'user-a');expect(c.access_token).toBe('fresh-access');expect(c.refresh_token).toBe('saved-refresh');});
  it('requires reconnect after revocation without exposing Google errors',async()=>{const f=fixture({refreshFails:true});await f.saved('user-a',true);const r=await f.request('sync');expect(r.status).toBe(409);expect(await r.text()).toBe('{"error":"reconnect_required"}');expect(f.calls).toHaveLength(1);});
  it('cannot resurrect a connection removed during token refresh',async()=>{const f=fixture({disconnectDuringRefresh:true});await f.saved('user-a',true);expect((await f.request('sync')).status).toBe(409);expect(f.connections.size).toBe(0);expect(f.calls).toHaveLength(1);});
  it('keeps channel data when analytics permissions or APIs fail',async()=>{const f=fixture({analyticsFails:true});await f.saved();const data=await (await f.request('sync')).json();expect(data.channel.id).toBe('channel-a');expect(data.analytics).toBeNull();expect(data.analyticsError).toBe('provider_permissions_or_api_disabled');});
  it('reports quota exhaustion without fabricated data',async()=>{const f=fixture({apiFails:403,quota:true});await f.saved();expect(await (await f.request('sync')).json()).toEqual({error:'quota_exceeded'});});
  it('handles provider timeouts with a recoverable error',async()=>{const f=fixture({timeout:true});await f.saved();const r=await f.request('sync');expect(r.status).toBe(502);expect(await r.json()).toEqual({error:'provider_unavailable'});});
  it('handles a provider 401 by asking for reconnection',async()=>{const f=fixture({apiFails:401});await f.saved();expect((await f.request('sync')).status).toBe(409);});
  it('disconnects only the authenticated creator and revokes Google access',async()=>{const f=fixture();await f.saved();await f.saved('user-b');const r=await f.request('disconnect','user-a-token',{user_id:'user-b'});expect(await r.json()).toEqual({connected:false,revoked:true});expect(f.connections.has('user-a')).toBe(false);expect(f.connections.has('user-b')).toBe(true);expect((await f.request('sync')).status).toBe(409);});
  it('still removes local access when provider revocation times out',async()=>{const f=fixture({timeout:true});await f.saved();expect(await (await f.request('disconnect')).json()).toEqual({connected:false,revoked:false});expect(f.connections.size).toBe(0);});
  it('cannot decrypt one creators credentials using another creator identity',async()=>{const cipher=await seal({access_token:'x',refresh_token:'y',expires_at:now},key,'user-a');await expect(unseal(cipher,key,'user-b')).rejects.toThrow();});
  it('uses an inclusive 28-day window across year boundaries',()=>{expect(reportWindow(Date.parse('2027-01-01T00:00:00Z'))).toEqual({startDate:'2026-12-04',endDate:'2026-12-31'});});
  it('rejects unknown actions and unsupported methods',async()=>{const f=fixture();expect((await f.request('delete-everyone')).status).toBe(400);expect((await f.handle(new Request(endpoint))).status).toBe(405);});
});
