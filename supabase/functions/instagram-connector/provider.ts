import { ConnectorError, counter, providerJson, safeLink } from '../_shared/social-core.ts';
import type { Grant, Provider } from '../_shared/social-core.ts';
export function instagramProvider(d: {clientId:string;clientSecret:string;callbackUrl:string;version:string;fetch:typeof fetch;now?:()=>number}): Provider {
  const now = d.now ?? Date.now;
  const scopes = ['instagram_business_basic','instagram_business_manage_insights'];
  const root = `https://graph.instagram.com/${d.version}`;
  const auth = (g: Grant) => ({Authorization:`Bearer ${g.access_token}`});
  const base = ['views','reach','saved','shares','total_interactions'];
  const storyMetrics = ['views','reach','replies','shares','total_interactions','follows','profile_visits'];
  const daily = ['views','reach','likes','comments','shares','saves','total_interactions'];
  const labels: Record<string,string> = {VIDEO:'Reel',IMAGE:'Photo',CAROUSEL_ALBUM:'Carousel'};
  // Thumbnails come from Meta's CDNs and expire; only https CDN URLs are passed through.
  const cdn = (value: unknown) => safeLink(value,'cdninstagram.com') ?? safeLink(value,'fbcdn.net');
  function item(v: any) {
    const type = String(v.media_type ?? '');
    return {id:v.id,title:labels[type] ?? 'Post',mediaType:type,publishedAt:typeof v.timestamp === 'string' && Number.isFinite(Date.parse(v.timestamp)) ? new Date(v.timestamp).toISOString() : null,url:safeLink(v.permalink,'instagram.com'),thumbnail:cdn(type === 'VIDEO' ? v.thumbnail_url ?? v.media_url : v.media_url)};
  }
  // Reads Graph insight rows (lifetime values or total_value) into name -> number|null.
  function readInsights(body: Record<string,any>, names: string[]) {
    const out: Record<string,number|null> = Object.fromEntries(names.map(n=>[n,null]));
    for (const row of Array.isArray(body.data) ? body.data : []) if (names.includes(row?.name)) out[row.name] = counter(row.total_value?.value ?? row.values?.[0]?.value);
    return out;
  }
  // A failed insight request (too few views, unsupported media, delayed data) leaves every metric unavailable.
  async function totals(g: Grant, url: string) { const names = new URL(url).searchParams.get('metric')!.split(','); return providerJson(d.fetch,url,{headers:auth(g)}).then(b=>readInsights(b,names),()=>readInsights({},names)); }
  const insights = (g: Grant, media: string, names: string[]) => totals(g,`${root}/${encodeURIComponent(media)}/insights?metric=${names.join(',')}`);
  function followTotals(body: Record<string,any>) {
    const results = body.data?.[0]?.total_value?.breakdowns?.[0]?.results;
    const pick = (key: string) => Array.isArray(results) ? counter(results.find((r:any)=>r?.dimension_values?.[0] === key)?.value) ?? 0 : null;
    return {follows:pick('FOLLOWER'),unfollows:pick('NON_FOLLOWER')};
  }
  function id(value: unknown): string {
    if (typeof value === 'string' && /^\d+$/.test(value)) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    throw new ConnectorError('invalid_provider_response',502);
  }
  function renewed(body: Record<string,any>, previous: Grant): Grant {
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number' || body.expires_in <= 0) throw new ConnectorError('invalid_provider_response',502);
    return {...previous,access_token:body.access_token,expires_at:now()+body.expires_in*1000,issued_at:now()};
  }
  return {
    name:'instagram',configured:!!(d.clientId && d.clientSecret && /^v\d+\.0$/.test(d.version)),scopes,
    authorize(state) { const url = new URL('https://www.instagram.com/oauth/authorize'); url.search = new URLSearchParams({client_id:d.clientId,redirect_uri:d.callbackUrl,response_type:'code',scope:scopes.join(','),state,enable_fb_login:'false',force_reauth:'true'}).toString(); return url.href; },
    async exchange(code) {
      const form = new FormData();
      for (const [key,value] of Object.entries({client_id:d.clientId,client_secret:d.clientSecret,grant_type:'authorization_code',redirect_uri:d.callbackUrl,code})) form.set(key,value);
      const result = await providerJson(d.fetch,'https://api.instagram.com/oauth/access_token',{method:'POST',body:form});
      const short = Array.isArray(result.data) ? result.data[0] : result;
      if (typeof short?.access_token !== 'string') throw new ConnectorError('invalid_provider_response',502);
      const permissions = Array.isArray(short.permissions) ? short.permissions : typeof short.permissions === 'string' ? short.permissions.split(',') : [];
      if (!scopes.every(scope=>permissions.includes(scope))) throw new ConnectorError('missing_permissions');
      const query = new URLSearchParams({grant_type:'ig_exchange_token',client_secret:d.clientSecret,access_token:short.access_token});
      const long = await providerJson(d.fetch,`https://graph.instagram.com/access_token?${query}`);
      return renewed(long,{access_token:short.access_token,refresh_token:'',account_id:id(short.user_id),expires_at:0,issued_at:now(),scopes:permissions});
    },
    shouldRefresh(g,time) { return g.expires_at <= time+7*86400000 && g.issued_at <= time-86400000; },
    async refresh(g) {
      if (g.expires_at <= now()) throw new ConnectorError('reconnect_required',409);
      const query = new URLSearchParams({grant_type:'ig_refresh_token',access_token:g.access_token});
      return renewed(await providerJson(d.fetch,`https://graph.instagram.com/refresh_access_token?${query}`),g);
    },
    async profile(g) {
      const result = await providerJson(d.fetch,`${root}/me?fields=id,user_id,username,account_type,profile_picture_url,followers_count,follows_count,media_count`,{headers:auth(g)});
      const user = Array.isArray(result.data) ? result.data[0] : result;
      if (!['BUSINESS','MEDIA_CREATOR'].includes(String(user?.account_type).toUpperCase())) throw new ConnectorError('professional_account_required');
      return {id:id(user.id),mediaId:id(user.user_id),title:typeof user.username === 'string' ? user.username : 'Instagram account',picture:cdn(user.profile_picture_url),statistics:{followers:counter(user.followers_count),following:counter(user.follows_count),posts:counter(user.media_count)}};
    },
    async videos(g,account) {
      const body = await providerJson(d.fetch,`${root}/${encodeURIComponent(account.mediaId ?? account.id)}/media?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=12`,{headers:auth(g)});
      if (!Array.isArray(body.data)) throw new ConnectorError('invalid_provider_response',502);
      const items = body.data.slice(0,12).filter((v:any)=>typeof v.id === 'string');
      return Promise.all(items.map(async (v:any)=>{
        const type = String(v.media_type ?? '');
        // Instagram Login cannot read media_product_type; new VIDEO media are Reels.
        const metrics = type === 'VIDEO' ? [...base,'ig_reels_avg_watch_time','ig_reels_video_view_total_time'] : [...base,'follows','profile_visits'];
        return {...item(v),statistics:{likes:counter(v.like_count),comments:counter(v.comments_count),...await insights(g,v.id,metrics)}};
      }));
    },
    async extras(g,account) {
      const owner = encodeURIComponent(account.mediaId ?? account.id);
      const end = Math.floor(now()/86400000)*86400; // Start of the current UTC day, in seconds.
      const days = await Promise.all(Array.from({length:28},async (_,i)=>{
        const since = end-(28-i)*86400;
        const values = await totals(g,`${root}/${owner}/insights?metric=${daily.join(',')}&metric_type=total_value&period=day&since=${since}&until=${since+86400}`);
        return {date:new Date(since*1000).toISOString().slice(0,10),...values};
      }));
      const follows = await providerJson(d.fetch,`${root}/${owner}/insights?metric=follows_and_unfollows&metric_type=total_value&period=day&breakdown=follow_type&since=${end-28*86400}&until=${end}`,{headers:auth(g)}).then(followTotals,()=>({follows:null,unfollows:null}));
      let stories: unknown[] | null = null;
      try {
        const body = await providerJson(d.fetch,`${root}/${owner}/stories?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp`,{headers:auth(g)});
        if (Array.isArray(body.data)) stories = await Promise.all(body.data.filter((v:any)=>typeof v.id === 'string').slice(0,20).map(async (v:any)=>({...item(v),statistics:await insights(g,v.id,storyMetrics)})));
      } catch { /* Stories edge unavailable: reported as null, never as zero stories. */ }
      return {insights:{startDate:days[0].date,endDate:days[days.length-1].date,days,...follows},stories};
    },
    // Local removal is supported. Provider revocation is deliberately not claimed
    // until the app's permissions endpoint is verified for Instagram Login.
    async revoke() { return false; },
  };
}
