import { describe, expect, it, vi } from 'vitest';
import { createSocialConnector, safeLink, providerJson, counter } from '../../../supabase/functions/_shared/social-core';
import type { Connection, Grant, Provider, State, Store } from '../../../supabase/functions/_shared/social-core';
import { hash, seal, unseal } from '../../../supabase/functions/youtube-connector/core';
import { tiktokProvider } from '../../../supabase/functions/tiktok-connector/provider';
import { instagramProvider } from '../../../supabase/functions/instagram-connector/provider';
const now = Date.UTC(2026,8,27);
const key = btoa('01234567890123456789012345678901');
const grant: Grant = {access_token:'access',refresh_token:'refresh',account_id:'123',expires_at:now+3600000,issued_at:now,scopes:['read']};
function fixture(name:'tiktok'|'instagram'='tiktok') {
  let connection: Connection|null = null;
  let state: State|null = null;
  const store: Store = {
    get:vi.fn(async()=>connection),put:vi.fn(async(c)=>{connection=c;}),
    refresh:vi.fn(async(c,previous)=>{if(connection?.credentials !== previous) return false; connection=c;return true;}),
    remove:vi.fn(async()=>{connection=null;}),createState:vi.fn(async(s)=>{state=s;}),
    consumeState:vi.fn(async(hash)=>{const s=state; if(s?.state_hash!==hash) return null;state=null;return s;}),
  };
  const provider: Provider = {name,configured:true,scopes:['read'],authorize:s=>`https://www.${name}.com/auth?state=${s}`,exchange:vi.fn(async()=>grant),refresh:vi.fn(async()=>({...grant,access_token:'rotated'})),shouldRefresh:g=>g.expires_at<=now,profile:vi.fn(async()=>({id:'123',title:'Owner'})),videos:vi.fn(async()=>[]),revoke:vi.fn(async()=>true)};
  const handler = createSocialConnector({store,provider,encryptionKey:key,origins:['http://localhost:5173'],authenticate:async(token)=>token==='valid'?'owner':null,now:()=>now});
  const request = (action:string,extras:Record<string,unknown>={},origin='http://localhost:5173',token='valid')=>handler(new Request(`https://backend/${name}-connector`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...extras})}));
  const callback = (state:string,error=false)=>handler(new Request(`https://backend/${name}-connector/callback?state=${state}&${error?'error=denied':'code=code'}`));
  async function connect() {const start=await (await request('start')).json();await callback(new URL(start.url).searchParams.get('state')!);}
  return {handler,store,provider,request,callback,connect,getConnection:()=>connection,setConnection:(c:Connection|null)=>{connection=c;},setState:(s:State)=>{state=s;}};
}
describe.each(['tiktok','instagram'] as const)('%s OAuth boundaries',name=>{
  it('requires verified bearer and allowed origin; ignores forged ownership',async()=>{
    const f=fixture(name);
    expect((await f.request('status',{},undefined,'forged')).status).toBe(401);
    expect((await f.request('start',{},'https://evil.example')).status).toBe(403);
    await f.request('start',{userId:'victim'});
    expect(f.store.createState).toHaveBeenCalledWith(expect.objectContaining({user_id:'owner',provider:name}));
  });
  it('hashes and consumes callback state once and stores only ciphertext',async()=>{
    const f=fixture(name);const start=await(await f.request('start')).json();const state=new URL(start.url).searchParams.get('state')!;
    expect(f.store.createState).toHaveBeenCalledWith(expect.objectContaining({state_hash:expect.not.stringContaining(state)}));
    const response=await f.callback(state);expect(response.headers.get('Location')).toContain(`${name}=connected`);
    expect(f.getConnection()?.credentials).not.toContain('access');
    expect((await f.callback(state)).status).toBe(400);
    expect(await(await f.request('status')).json()).toEqual(expect.objectContaining({connected:true,account:{id:'123',title:'Owner',connectedAt:expect.any(String)}}));
  });
  it('preserves existing connection on canceled consent or missing scope',async()=>{
    const f=fixture(name);await f.connect();const saved=f.getConnection();
    let start=await(await f.request('start')).json();await f.callback(new URL(start.url).searchParams.get('state')!,true);
    expect(f.getConnection()).toBe(saved);
    f.provider.exchange=async()=>({...grant,scopes:[]});start=await(await f.request('start')).json();
    expect((await f.callback(new URL(start.url).searchParams.get('state')!)).headers.get('Location')).toContain('missing_permissions');
    expect(f.getConnection()).toBe(saved);
  });
  it('never resurrects a disconnected connection during refresh',async()=>{
    const f=fixture(name);await f.connect();const saved=f.getConnection()!;
    f.setConnection({...saved,credentials:await seal({...grant,expires_at:now-1},key,`${name}:owner`)});
    f.provider.refresh=async()=>{f.setConnection(null);return grant;};
    expect(await(await f.request('sync')).json()).toEqual({error:'connection_changed_retry'});
    expect(f.getConnection()).toBeNull();
  });
  it('removes local credentials even if revocation fails',async()=>{
    const f=fixture(name);await f.connect();f.provider.revoke=async()=>{throw new Error('secret-provider-error');};
    expect(await(await f.request('disconnect')).json()).toEqual({connected:false,revoked:false});
    expect(f.getConnection()).toBeNull();
  });
  it('rejects expired state and callbacks belonging to another provider',async()=>{
    const f=fixture(name);
    for(const state of [{provider:name,expires_at:new Date(now-1).toISOString()},{provider:name==='tiktok'?'instagram':'tiktok',expires_at:new Date(now+60000).toISOString()}]) {
      f.setState({...state,state_hash:await hash('csrf'),user_id:'owner',origin:'http://localhost:5173'});
      expect((await f.callback('csrf')).status).toBe(400);
    }
    expect(f.provider.exchange).not.toHaveBeenCalled();
  });
  it('rejects changes to account identity during sync',async()=>{
    const f=fixture(name);await f.connect();f.provider.profile=async()=>({id:'other',title:'other'});
    expect(await(await f.request('sync')).json()).toEqual({error:'account_access_changed'});
  });
});
describe('provider data and credential boundaries',()=>{
  it('binds encryption to both provider and owner',async()=>{
    const value=await seal(grant,key,'tiktok:owner');
    await expect(unseal(value,key,'instagram:owner')).rejects.toThrow();
    await expect(unseal(value,key,'tiktok:other')).rejects.toThrow();
  });
  it('sanitizes errors and unsupported links and preserves zero counters',async()=>{
    await expect(providerJson(async()=>new Response(JSON.stringify({error:{code:'access_token_invalid',message:'secret'}}),{status:200}),'https://provider')).rejects.toMatchObject({code:'reconnect_required'});
    await expect(providerJson(async()=>new Response(JSON.stringify({error:{code:200,type:'OAuthException',message:'API access blocked.'}}),{status:400}),'https://provider/me')).rejects.toMatchObject({code:'provider_access_blocked'});
    expect(safeLink('https://www.tiktok.com/@me/video/1','tiktok.com')).toContain('tiktok.com');
    expect(safeLink('https://tiktok.com.evil.test/','tiktok.com')).toBeNull();expect(safeLink('javascript:alert(1)','instagram.com')).toBeNull();
    expect(counter(0)).toBe(0);expect(counter(undefined)).toBeNull();
  });
  it('uses TikTok web OAuth, required scopes and rotates refresh tokens',async()=>{
    const calls: {url:string;init:RequestInit|undefined}[]=[];
    const p=tiktokProvider({clientId:'client',clientSecret:'secret',callbackUrl:'https://backend/callback',now:()=>now,fetch:async(input,init)=>{calls.push({url:String(input),init});return new Response(JSON.stringify({access_token:'new',refresh_token:'rotated',open_id:'123',scope:'user.info.basic,video.list',expires_in:86400,refresh_expires_in:31536000}));}});
    const url=new URL(p.authorize('csrf'));expect(url.searchParams.get('scope')).toBe('user.info.basic,video.list');expect(url.searchParams.get('client_key')).toBe('client');
    const token=await p.exchange('code+encoded');expect(new URLSearchParams(calls[0].init?.body as URLSearchParams).get('code')).toBe('code+encoded');
    expect((await p.refresh(token)).refresh_token).toBe('rotated');
  });
  it('reads TikTok counters and refuses missing permissions',async()=>{
    const p=tiktokProvider({clientId:'c',clientSecret:'s',callbackUrl:'https://backend/callback',fetch:async()=>new Response(JSON.stringify({data:{videos:[{id:'1',title:'real',create_time:1,view_count:0,share_url:'https://evil.test',cover_image_url:'https://p16-sign.tiktokcdn-us.com/c.jpg'},{id:'2',cover_image_url:'https://evil.test/c.jpg'}]},error:{code:'ok'}}))});
    const videos=await p.videos(grant,{id:'123',title:'me'});expect(videos[0].statistics).toEqual({views:0,likes:null,comments:null,shares:null});expect(videos[0].url).toBeNull();expect(videos.map(v=>v.thumbnail)).toEqual(['https://p16-sign.tiktokcdn-us.com/c.jpg',null]);
  });
  it('exchanges Instagram grants for long-lived access and refreshes only after 24h',async()=>{
    let call=0;const calls:string[]=[];
    const p=instagramProvider({clientId:'c',clientSecret:'s',callbackUrl:'https://backend/callback',version:'v26.0',now:()=>now,fetch:async(input)=>{calls.push(String(input));return new Response(JSON.stringify(++call===1 ? {access_token:'short',user_id:'123',permissions:['instagram_business_basic','instagram_business_manage_insights']} : {access_token:'long',expires_in:5184000}));}});
    expect(new URL(p.authorize('csrf')).searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_insights');
    const token=await p.exchange('code');expect(token.access_token).toBe('long');expect(calls[1]).toContain('ig_exchange_token');
    expect(p.shouldRefresh({...token,expires_at:now+86400000},now)).toBe(false);
    expect(p.shouldRefresh({...token,issued_at:now-86400001,expires_at:now+86400000},now)).toBe(true);
    await expect(p.refresh({...token,expires_at:now-1})).rejects.toMatchObject({code:'reconnect_required'});
  });
  it('keeps Instagram unconfigured without an explicit API version',()=>{
    expect(instagramProvider({clientId:'c',clientSecret:'s',callbackUrl:'https://backend/callback',version:'',fetch}).configured).toBe(false);
  });
  it('uses app-scoped ID for ownership and professional ID for media, preserving large IDs',async()=>{
    const calls:string[]=[];
    const p=instagramProvider({clientId:'c',clientSecret:'s',callbackUrl:'https://backend/callback',version:'v26.0',fetch:async(input)=>{
      calls.push(String(input));return new Response(calls.length===1 ? '{"data":[{"id":"123","user_id":17841400000000001,"username":"owner","account_type":"MEDIA_CREATOR"}]}' : '{"data":[{"id":"1","media_type":"IMAGE","like_count":0,"comments_count":2,"permalink":"https://www.instagram.com/p/test/"}]}');
    }});
    const account=await p.profile(grant);expect(account.id).toBe('123');expect(account.mediaId).toBe('17841400000000001');
    const videos=await p.videos(grant,account);expect(calls[1]).toContain('/17841400000000001/media?');expect(calls[1]).not.toContain('caption');expect(videos[0]).toMatchObject({title:'Photo',thumbnail:null,statistics:{likes:0,comments:2,views:null,follows:null}});
  });
  it('reads Instagram media and account insights, keeping failures unavailable',async()=>{
    const calls:string[]=[];
    const p=instagramProvider({clientId:'c',clientSecret:'s',callbackUrl:'https://backend/callback',version:'v26.0',now:()=>Date.UTC(2026,8,27,12),fetch:async(input)=>{
      const url=String(input);calls.push(url);
      if(url.includes('/media?')) return new Response(JSON.stringify({data:[{id:'9',media_type:'VIDEO',thumbnail_url:'https://scontent.cdninstagram.com/t.jpg',like_count:4}]}));
      if(url.includes('/9/insights')) return new Response(JSON.stringify({data:[{name:'views',values:[{value:120}]},{name:'ig_reels_avg_watch_time',values:[{value:3400}]}]}));
      if(url.includes('follows_and_unfollows')) return new Response(JSON.stringify({data:[{total_value:{breakdowns:[{results:[{dimension_values:['FOLLOWER'],value:7}]}]}}]}));
      if(url.includes('/stories')) return new Response('{"error":{"code":10}}',{status:400});
      if(url.includes('/insights?metric=views,reach')) return new Response(JSON.stringify({data:[{name:'views',total_value:{value:10}}]}));
      return new Response('{}');
    }});
    const account={id:'123',title:'me',mediaId:'178'};
    const [video]=await p.videos(grant,account);
    expect(video).toMatchObject({title:'Reel',thumbnail:'https://scontent.cdninstagram.com/t.jpg',statistics:{likes:4,views:120,ig_reels_avg_watch_time:3400,reach:null}});
    expect(calls.find(c=>c.includes('/9/insights'))).toContain('ig_reels_avg_watch_time');
    const extras=await p.extras!(grant,account) as any;
    expect(extras.insights.days).toHaveLength(28);expect(extras.insights.endDate).toBe('2026-09-26');
    expect(extras.insights.days[0]).toMatchObject({views:10,likes:null});
    expect(extras.insights).toMatchObject({follows:7,unfollows:0});
    expect(extras.stories).toBeNull();
  });
});
