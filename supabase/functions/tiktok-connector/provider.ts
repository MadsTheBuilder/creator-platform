import { ConnectorError, counter, providerJson, safeLink } from '../_shared/social-core.ts';
import type { Grant, Provider } from '../_shared/social-core.ts';
export function tiktokProvider(d: {clientId:string;clientSecret:string;callbackUrl:string;fetch:typeof fetch;now?:()=>number}): Provider {
  const now = d.now ?? Date.now;
  const scopes = ['user.info.basic','video.list'];
  // Covers and avatars are signed, expiring TikTok CDN URLs; only https CDN hosts are passed through.
  const cdn = (value: unknown) => safeLink(value,'tiktokcdn.com') ?? safeLink(value,'tiktokcdn-us.com') ?? safeLink(value,'tiktokcdn-eu.com');
  async function token(params: Record<string,string>) {
    return providerJson(d.fetch,'https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_key:d.clientId,client_secret:d.clientSecret})});
  }
  function grant(body: Record<string,any>): Grant {
    if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || !body.refresh_token || typeof body.open_id !== 'string' || typeof body.expires_in !== 'number' || body.expires_in <= 0 || typeof body.refresh_expires_in !== 'number' || body.refresh_expires_in <= 0) throw new ConnectorError('invalid_provider_response',502);
    return {access_token:body.access_token,refresh_token:body.refresh_token,account_id:body.open_id,expires_at:now()+body.expires_in*1000,refresh_expires_at:now()+body.refresh_expires_in*1000,issued_at:now(),scopes:typeof body.scope === 'string' ? body.scope.split(',') : []};
  }
  return {
    name:'tiktok',configured:!!(d.clientId && d.clientSecret),scopes,
    authorize(state) { const url = new URL('https://www.tiktok.com/v2/auth/authorize/'); url.search = new URLSearchParams({client_key:d.clientId,redirect_uri:d.callbackUrl,response_type:'code',scope:scopes.join(','),state,disable_auto_auth:'1'}).toString(); return url.href; },
    async exchange(code) { return grant(await token({grant_type:'authorization_code',code,redirect_uri:d.callbackUrl})); },
    shouldRefresh(g,time) { return g.expires_at <= time+60000; },
    async refresh(g) { if ((g.refresh_expires_at ?? 0) <= now()) throw new ConnectorError('reconnect_required',409); return grant(await token({grant_type:'refresh_token',refresh_token:g.refresh_token})); },
    async profile(g) {
      const body = await providerJson(d.fetch,'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url',{headers:{Authorization:`Bearer ${g.access_token}`}});
      const user = body.data?.user;
      if (typeof user?.open_id !== 'string') throw new ConnectorError('invalid_provider_response',502);
      return {id:user.open_id,title:typeof user.display_name === 'string' ? user.display_name : 'TikTok account',picture:cdn(user.avatar_url)};
    },
    async videos(g) {
      const body = await providerJson(d.fetch,'https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,cover_image_url,view_count,like_count,comment_count,share_count',{method:'POST',headers:{Authorization:`Bearer ${g.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({max_count:10})});
      if (!Array.isArray(body.data?.videos)) throw new ConnectorError('invalid_provider_response',502);
      return body.data.videos.slice(0,10).filter((v:any)=>typeof v.id === 'string').map((v:any)=>({id:v.id,title:typeof v.title === 'string' ? v.title : typeof v.video_description === 'string' ? v.video_description : 'Untitled video',publishedAt:typeof v.create_time === 'number' && Number.isFinite(v.create_time) && v.create_time > 0 && v.create_time < 8640000000000 ? new Date(v.create_time*1000).toISOString() : null,url:safeLink(v.share_url,'tiktok.com'),thumbnail:cdn(v.cover_image_url),statistics:{views:counter(v.view_count),likes:counter(v.like_count),comments:counter(v.comment_count),shares:counter(v.share_count)}}));
    },
    async revoke(g) { await providerJson(d.fetch,'https://open.tiktokapis.com/v2/oauth/revoke/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_key:d.clientId,client_secret:d.clientSecret,token:g.access_token})}); return true; },
  };
}
