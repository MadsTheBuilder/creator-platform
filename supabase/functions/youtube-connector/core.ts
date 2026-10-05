export const scopes = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];
export type Credentials = { access_token: string; refresh_token: string; expires_at: number };
export type Connection = { user_id: string; credentials: string; channel_id: string; channel_title: string; connected_at?: string };
export type OAuthState = { state_hash: string; user_id: string; verifier: string; origin: string; expires_at: string };
export interface Store {
  get(userId: string): Promise<Connection | null>;
  put(connection: Connection): Promise<void>;
  refresh(connection: Connection, previousCredentials: string): Promise<boolean>;
  remove(userId: string): Promise<void>;
  createState(state: OAuthState): Promise<void>;
  consumeState(hash: string): Promise<OAuthState | null>;
}
export interface Dependencies {
  store: Store;
  authenticate(token: string): Promise<string | null>;
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
  callbackUrl: string;
  origins: string[];
  now?: () => number;
}
export class ConnectorError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const encoder = new TextEncoder();
function b64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function unb64(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
function base64url(bytes: Uint8Array): string { return b64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
export async function hash(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
export async function seal(value: Credentials, secret: string, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', unb64(secret), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(userId) }, key, encoder.encode(JSON.stringify(value)));
  return `${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}
export async function unseal(value: string, secret: string, userId: string): Promise<Credentials> {
  const [iv, cipher] = value.split('.');
  const key = await crypto.subtle.importKey('raw', unb64(secret), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: encoder.encode(userId) }, key, unb64(cipher));
  return JSON.parse(new TextDecoder().decode(plain));
}
export function reportWindow(now: number) {
  const end = new Date(now); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 27);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
type Item = { id: string; snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string }; thumbnails?: Record<string, { url?: string }> }; statistics?: Record<string, string | boolean>; contentDetails?: { relatedPlaylists?: { uploads?: string } } };
type Items = { items?: Item[] };
// Thumbnails come from Google's image CDNs; only https URLs on those hosts are passed through.
function image(item: Item): string | null {
  const t = item.snippet?.thumbnails;
  try { const url = new URL(String((t?.medium ?? t?.high ?? t?.default)?.url)); return url.protocol === 'https:' && /(^|\.)(ytimg|ggpht|googleusercontent)\.com$/.test(url.hostname) ? url.href : null; } catch { return null; }
}
const videoMetrics = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'comments', 'shares', 'subscribersGained'];
export function createConnector(d: Dependencies) {
  const now = d.now ?? Date.now;
  const configured = () => !!(d.clientId && d.clientSecret && d.encryptionKey);
  async function external(url: string, init: RequestInit = {}): Promise<Response> {
    try { return await d.fetch(url, { ...init, signal: AbortSignal.timeout(15000) }); }
    catch { throw new ConnectorError('provider_unavailable', 502); }
  }
  async function api<T>(url: string, token: string): Promise<T> {
    const response = await external(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const reason = body.error?.errors?.[0]?.reason;
      throw new ConnectorError(response.status === 401 ? 'reconnect_required' : reason === 'quotaExceeded' ? 'quota_exceeded' : 'provider_permissions_or_api_disabled', response.status === 401 ? 409 : 502);
    }
    return response.json();
  }
  async function token(body: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await external('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, client_id: d.clientId, client_secret: d.clientSecret }),
    });
    if (!response.ok) throw new ConnectorError('reconnect_required', 409);
    const result = await response.json();
    if (typeof result.access_token !== 'string' || typeof result.expires_in !== 'number') throw new ConnectorError('invalid_provider_response', 502);
    return result;
  }
  async function access(connection: Connection): Promise<string> {
    const saved = await unseal(connection.credentials, d.encryptionKey, connection.user_id);
    if (saved.expires_at > now() + 60000) return saved.access_token;
    const fresh = await token({ grant_type: 'refresh_token', refresh_token: saved.refresh_token });
    const updated = { access_token: String(fresh.access_token), refresh_token: typeof fresh.refresh_token === 'string' ? fresh.refresh_token : saved.refresh_token, expires_at: now() + Number(fresh.expires_in) * 1000 };
    const persisted = await d.store.refresh({ ...connection, credentials: await seal(updated, d.encryptionKey, connection.user_id) }, connection.credentials);
    if (!persisted) throw new ConnectorError('connection_changed_retry', 409);
    return updated.access_token;
  }
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors: Record<string, string> = { 'Vary': 'Origin', 'Cache-Control': 'no-store' };
    if (origin && d.origins.includes(origin)) {
      cors['Access-Control-Allow-Origin'] = origin;
      cors['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
      cors['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    }
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    const redirect = (target: string, result: string) => {
      const destination = new URL(target); destination.searchParams.set('youtube', result); destination.hash = 'connections';
      return new Response(null, { status: 303, headers: { Location: destination.href, 'Cache-Control': 'no-store' } });
    };
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: origin && d.origins.includes(origin) ? 204 : 403, headers: cors });
      if (request.method === 'GET' && url.searchParams.get('action') === 'callback') {
        if (!configured()) throw new ConnectorError('setup_required', 503);
        const rawState = url.searchParams.get('state');
        if (!rawState) throw new ConnectorError('invalid_state');
        const state = await d.store.consumeState(await hash(rawState));
        if (!state || Date.parse(state.expires_at) <= now() || !d.origins.includes(state.origin)) throw new ConnectorError('invalid_or_expired_state');
        if (url.searchParams.has('error')) return redirect(state.origin, 'consent_cancelled');
        try {
          const code = url.searchParams.get('code');
          if (!code) throw new ConnectorError('missing_code');
          const grant = await token({ grant_type: 'authorization_code', code, code_verifier: state.verifier, redirect_uri: d.callbackUrl });
          const granted = typeof grant.scope === 'string' ? grant.scope.split(' ') : [];
          if (!scopes.every(scope => granted.includes(scope))) throw new ConnectorError('missing_permissions');
          if (typeof grant.refresh_token !== 'string') throw new ConnectorError('offline_access_required');
          const result = await api<Items>('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true', String(grant.access_token));
          const channel = result.items?.[0];
          if (!channel) throw new ConnectorError('no_channel');
          // Reconnect is explicit. One selected Google/Brand account per creator in this slice.
          await d.store.put({ user_id: state.user_id, channel_id: channel.id, channel_title: channel.snippet?.title ?? 'YouTube channel', credentials: await seal({ access_token: String(grant.access_token), refresh_token: grant.refresh_token, expires_at: now() + Number(grant.expires_in) * 1000 }, d.encryptionKey, state.user_id), connected_at: new Date(now()).toISOString() });
          return redirect(state.origin, 'connected');
        } catch (cause) { return redirect(state.origin, cause instanceof ConnectorError ? cause.code : 'connection_failed'); }
      }
      if (request.method !== 'POST') throw new ConnectorError('method_not_allowed', 405);
      if (!origin || !d.origins.includes(origin)) throw new ConnectorError('origin_not_allowed', 403);
      const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
      const userId = bearer ? await d.authenticate(bearer) : null;
      if (!userId) throw new ConnectorError('sign_in_required', 401);
      const body = await request.json().catch(() => null);
      const action = body?.action;
      if (!['status', 'start', 'sync', 'disconnect'].includes(action)) throw new ConnectorError('invalid_action');
      if (action === 'status') {
        const connection = await d.store.get(userId);
        return json({ configured: configured(), connected: !!connection, channel: connection ? { id: connection.channel_id, title: connection.channel_title, connectedAt: connection.connected_at } : null });
      }
      if (!configured()) throw new ConnectorError('setup_required', 503);
      if (action === 'start') {
        const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
        const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
        await d.store.createState({ state_hash: await hash(state), user_id: userId, verifier, origin, expires_at: new Date(now() + 10 * 60000).toISOString() });
        const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        consent.search = new URLSearchParams({ client_id: d.clientId, redirect_uri: d.callbackUrl, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: await hash(verifier), code_challenge_method: 'S256' }).toString();
        return json({ url: consent.href });
      }
      const connection = await d.store.get(userId);
      if (!connection) throw new ConnectorError('not_connected', 409);
      if (action === 'disconnect') {
        const saved = await unseal(connection.credentials, d.encryptionKey, userId);
        let revoked = false;
        try { revoked = (await external('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: saved.refresh_token }) })).ok; } catch { /* Remove local access even if Google is unavailable. */ }
        await d.store.remove(userId);
        return json({ connected: false, revoked });
      }
      const current = await access(connection);
      const channels = await api<Items>('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true', current);
      const channel = channels.items?.find(item => item.id === connection.channel_id);
      if (!channel) throw new ConnectorError('channel_access_changed', 409);
      const playlist = channel.contentDetails?.relatedPlaylists?.uploads;
      let videos: Item[] = [];
      if (playlist) {
        const uploads = await api<Items>(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=10&playlistId=${encodeURIComponent(playlist)}`, current);
        const ids = uploads.items?.map(item => item.snippet?.resourceId?.videoId).filter(Boolean).join(',');
        if (ids) videos = (await api<Items>(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${encodeURIComponent(ids)}`, current)).items ?? [];
      }
      const window = reportWindow(now());
      let analytics: unknown = null;
      let analyticsError: string | null = null;
      try {
        const query = new URLSearchParams({ ids: 'channel==MINE', ...window, dimensions: 'day', metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost', sort: 'day' });
        analytics = await api(`https://youtubeanalytics.googleapis.com/v2/reports?${query}`, current);
      } catch (cause) { analyticsError = cause instanceof ConnectorError ? cause.code : 'analytics_unavailable'; }
      // Per-video analytics since each upload's publish date; videos without a returned row stay null.
      const insights: Record<string, Record<string, number>> = {};
      if (videos.length) try {
        const startDate = videos.map(v => v.snippet?.publishedAt?.slice(0, 10) ?? window.startDate).reduce((a, b) => a < b ? a : b, window.startDate);
        const query = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate: window.endDate, dimensions: 'video', metrics: videoMetrics.join(','), filters: `video==${videos.map(v => v.id).join(',')}`, sort: '-views', maxResults: '10' });
        const report = await api<{ columnHeaders?: { name: string }[]; rows?: unknown[][] }>(`https://youtubeanalytics.googleapis.com/v2/reports?${query}`, current);
        const names = report.columnHeaders?.map(h => h.name) ?? [], at = names.indexOf('video');
        if (at >= 0) for (const row of report.rows ?? []) insights[String(row[at])] = Object.fromEntries(videoMetrics.flatMap(m => { const value = row[names.indexOf(m)]; return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? [[m, value]] : []; }));
      } catch { /* Per-video analytics unavailable: reported as null, never as zero. */ }
      return json({ source: 'YouTube APIs', observedAt: new Date(now()).toISOString(), window, channel: { id: channel.id, title: channel.snippet?.title, picture: image(channel), statistics: channel.statistics ?? {} }, videos: videos.map(video => ({ id: video.id, title: video.snippet?.title, publishedAt: video.snippet?.publishedAt, thumbnail: image(video), statistics: video.statistics ?? {}, insights: insights[video.id] ?? null })), analytics, analyticsError, retention: null });
    } catch (cause) { return json({ error: cause instanceof ConnectorError ? cause.code : 'connector_unavailable' }, cause instanceof ConnectorError ? cause.status : 500); }
  };
}
