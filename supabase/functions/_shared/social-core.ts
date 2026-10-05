import { ConnectorError, hash, seal, unseal } from '../youtube-connector/core.ts';
export { ConnectorError };
export type Grant = { access_token: string; refresh_token: string; expires_at: number; issued_at: number; account_id: string; scopes: string[]; refresh_expires_at?: number };
export type Account = { id: string; title: string; mediaId?: string; picture?: string | null; statistics?: Record<string, number | null> };
export type Connection = { provider: string; user_id: string; credentials: string; account_id: string; account_title: string; connected_at: string };
export type State = { provider: string; state_hash: string; user_id: string; origin: string; expires_at: string };
export type Video = { id: string; title: string; publishedAt: string | null; url: string | null; statistics: Record<string, number | null>; thumbnail?: string | null; mediaType?: string };
export interface Store {
  get(user: string): Promise<Connection | null>;
  put(connection: Connection): Promise<void>;
  refresh(connection: Connection, previous: string): Promise<boolean>;
  remove(user: string): Promise<void>;
  createState(state: State): Promise<void>;
  consumeState(hash: string): Promise<State | null>;
}
export interface Provider {
  name: 'tiktok' | 'instagram'; configured: boolean; scopes: string[];
  authorize(state: string): string;
  exchange(code: string): Promise<Grant>;
  refresh(grant: Grant): Promise<Grant>;
  shouldRefresh(grant: Grant, now: number): boolean;
  profile(grant: Grant): Promise<Account>;
  videos(grant: Grant, account: Account): Promise<Video[]>;
  revoke(grant: Grant): Promise<boolean>;
  // Optional provider-specific analytics merged into the sync response.
  extras?(grant: Grant, account: Account): Promise<Record<string, unknown>>;
}
export function createSocialConnector(d: { store: Store; provider: Provider; authenticate(token: string): Promise<string | null>; encryptionKey: string; origins: string[]; now?: () => number }) {
  const now = d.now ?? Date.now;
  const p = d.provider;
  const configured = () => p.configured && !!d.encryptionKey;
  const binding = (user: string) => `${p.name}:${user}`;
  function validate(grant: Grant) {
    if (!grant.access_token || !grant.account_id || !Number.isFinite(grant.expires_at) || grant.expires_at <= now()) throw new ConnectorError('invalid_provider_response', 502);
    if (!p.scopes.every(scope => grant.scopes.includes(scope))) throw new ConnectorError('missing_permissions');
  }
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const allowed = !!origin && d.origins.includes(origin);
    const headers: Record<string,string> = { 'Cache-Control': 'no-store', Vary: 'Origin', 'Referrer-Policy': 'no-referrer' };
    if (allowed) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {...headers, 'Content-Type':'application/json'}});
    const redirect = (origin: string, result: string) => {
      const target = new URL(origin); target.searchParams.set(p.name, result); target.hash = 'connections';
      return new Response(null, {status:303, headers:{...headers, Location:target.href}});
    };
    try {
      if (request.method === 'OPTIONS') return new Response(null, {status:allowed ? 204 : 403, headers});
      if (request.method === 'GET' && url.pathname.endsWith('/callback')) {
        if (!configured()) throw new ConnectorError('setup_required', 503);
        const raw = url.searchParams.get('state');
        if (!raw) throw new ConnectorError('invalid_state');
        const state = await d.store.consumeState(await hash(raw));
        if (!state || state.provider !== p.name || !Number.isFinite(Date.parse(state.expires_at)) || Date.parse(state.expires_at) <= now() || !d.origins.includes(state.origin)) throw new ConnectorError('invalid_or_expired_state');
        if (url.searchParams.has('error')) return redirect(state.origin, 'consent_cancelled');
        try {
          const code = url.searchParams.get('code');
          if (!code) throw new ConnectorError('missing_code');
          const grant = await p.exchange(code); validate(grant);
          const account = await p.profile(grant);
          if (account.id !== grant.account_id) throw new ConnectorError('account_access_changed', 409);
          await d.store.put({provider:p.name,user_id:state.user_id,account_id:account.id,account_title:account.title,credentials:await seal(grant,d.encryptionKey,binding(state.user_id)),connected_at:new Date(now()).toISOString()});
          return redirect(state.origin,'connected');
        } catch (cause) { return redirect(state.origin,cause instanceof ConnectorError ? cause.code : 'connection_failed'); }
      }
      if (request.method !== 'POST') throw new ConnectorError('method_not_allowed',405);
      if (!allowed) throw new ConnectorError('origin_not_allowed',403);
      const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
      const user = bearer ? await d.authenticate(bearer) : null;
      if (!user) throw new ConnectorError('sign_in_required',401);
      const body = await request.json().catch(()=>null);
      const action = body?.action;
      if (!['status','start','sync','disconnect'].includes(action)) throw new ConnectorError('invalid_action');
      if (action === 'status') {
        const saved = await d.store.get(user);
        return json({configured:configured(),connected:!!saved,account:saved ? {id:saved.account_id,title:saved.account_title,connectedAt:saved.connected_at} : null});
      }
      if (action === 'start') {
        if (!configured()) throw new ConnectorError('setup_required',503);
        const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), n=>n.toString(16).padStart(2,'0')).join('');
        await d.store.createState({provider:p.name,state_hash:await hash(state),user_id:user,origin:origin!,expires_at:new Date(now()+600000).toISOString()});
        return json({url:p.authorize(state)});
      }
      let saved = await d.store.get(user);
      if (!saved) throw new ConnectorError('not_connected',409);
      if (action === 'disconnect') {
        // Local removal is authoritative even when decryption or provider revocation fails.
        await d.store.remove(user);
        let revoked = false;
        try { revoked = await p.revoke(await unseal(saved.credentials,d.encryptionKey,binding(user)) as Grant); } catch { /* No tokens or provider errors leave the server. */ }
        return json({connected:false,revoked});
      }
      if (!configured()) throw new ConnectorError('setup_required',503);
      let grant = await unseal(saved.credentials,d.encryptionKey,binding(user)) as Grant;
      if (p.shouldRefresh(grant,now())) {
        const fresh = await p.refresh(grant); validate(fresh);
        if (fresh.account_id !== saved.account_id) throw new ConnectorError('account_access_changed',409);
        const updated = {...saved,credentials:await seal(fresh,d.encryptionKey,binding(user))};
        if (!await d.store.refresh(updated,saved.credentials)) throw new ConnectorError('connection_changed_retry',409);
        saved = updated; grant = fresh;
      }
      if (grant.expires_at <= now()) throw new ConnectorError('reconnect_required',409);
      validate(grant);
      const account = await p.profile(grant);
      if (account.id !== saved.account_id) throw new ConnectorError('account_access_changed',409);
      const [videos,extras] = await Promise.all([p.videos(grant,account),p.extras ? p.extras(grant,account) : {}]);
      const current = await d.store.get(user);
      if (current?.credentials !== saved.credentials) throw new ConnectorError('connection_changed_retry',409);
      return json({source:p.name === 'tiktok' ? 'TikTok Display API' : 'Instagram API',observedAt:new Date(now()).toISOString(),account,videos,retention:null,...extras});
    } catch (cause) { return json({error:cause instanceof ConnectorError ? cause.code : 'connector_unavailable'},cause instanceof ConnectorError ? cause.status : 500); }
  };
}
export async function providerJson(fetcher: typeof fetch, url: string, init: RequestInit = {}): Promise<Record<string, any>> {
  let response: Response;
  try { response = await fetcher(url,{...init,signal:AbortSignal.timeout(15000)}); }
  catch { throw new ConnectorError('provider_unavailable',502); }
  // Meta can encode user IDs as JSON numbers wider than JavaScript's safe integer
  // range. Preserve their decimal spelling before JSON parsing loses precision.
  const raw = await response.text();
  let body: any = null;
  try { body = JSON.parse(raw.replace(/("user_id"\s*:\s*)(\d{16,})(?=\s*[,}])/g,'$1"$2"')); } catch { /* Sanitized below. */ }
  const error = body?.error;
  if (!response.ok || error && error.code !== 'ok') {
    const code = error?.code;
    // Pathname and the provider's error fields only: tokens live in headers or the query string.
    console.error('provider_error', JSON.stringify({path:new URL(url).pathname,status:response.status,code,subcode:error?.error_subcode,type:error?.type,message:typeof error?.message === 'string' ? error.message.slice(0,300) : undefined}));
    if (response.status === 429 || code === 'rate_limit_exceeded') throw new ConnectorError('rate_limited',429);
    if (response.status === 401 || ['access_token_invalid','invalid_grant',190].includes(code) || typeof error === 'string' && error === 'invalid_grant') throw new ConnectorError('reconnect_required',409);
    // Meta returns code 200 "API access blocked" when the app itself is restricted; reconnecting cannot fix it.
    if (code === 200 && /access blocked/i.test(String(error?.message))) throw new ConnectorError('provider_access_blocked',502);
    throw new ConnectorError('provider_permissions_or_configuration',502);
  }
  if (!body || typeof body !== 'object') throw new ConnectorError('invalid_provider_response',502);
  return body;
}
export function counter(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
export function safeLink(value: unknown, domain: string): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null; } catch { return null; }
}
