import { supabase } from './supabase';
export type SocialProvider = 'tiktok' | 'instagram';
export type SocialStatus = {configured:boolean;connected:boolean;account:{id:string;title:string;connectedAt?:string} | null};
export type SocialSnapshot = {source:string;observedAt:string;account:{id:string;title:string;picture?:string|null};videos:{id:string;title:string;publishedAt:string|null;url:string|null;thumbnail?:string|null;statistics:Record<string,number|null>}[]};
export type InstagramMedia = SocialSnapshot['videos'][number] & {thumbnail:string|null;mediaType:string};
export type InstagramDay = {date:string} & Record<'views'|'reach'|'likes'|'comments'|'shares'|'saves'|'total_interactions',number|null>;
export type InstagramSnapshot = Omit<SocialSnapshot,'videos'> & {
  account:{id:string;title:string;picture:string|null;statistics:Record<'followers'|'following'|'posts',number|null>};
  videos:InstagramMedia[]; stories:InstagramMedia[]|null;
  insights:{startDate:string;endDate:string;days:InstagramDay[];follows:number|null;unfollows:number|null};
};
export const socialMessages: Record<string,string> = {
  sign_in_required:'Sign in to Creator OS above first.', setup_required:'Provider app configuration is still required.',
  connected:'Account connected. Refresh to load real content.', consent_cancelled:'Consent was cancelled. You can try again.',
  missing_permissions:'The required read-only permission was not granted. Please reconnect and approve access.',
  reconnect_required:'Access expired or was revoked. Please reconnect.', not_connected:'Connect your account first.',
  invalid_or_expired_state:'The connection request expired. Start again from Connections.',
  account_access_changed:'The connected account is no longer accessible. Please reconnect.',
  connection_changed_retry:'The connection changed in another tab. Reload and try again.',
  provider_permissions_or_configuration:'The provider rejected this request. Check app activation, callback registration, tester access and permissions.',
  provider_access_blocked:'The provider has blocked API access for the Creator OS app. Check the app dashboard for restrictions or required actions; reconnecting will not help until it is lifted.',
  rate_limited:'The provider rate limit was reached. Try again later.',
  professional_account_required:'Choose an Instagram Business or Creator professional account.',
  provider_unavailable:'The provider did not respond. Try again later.',
};
export async function socialRequest<T>(provider: SocialProvider, action:'status'|'start'|'sync'|'disconnect'): Promise<T> {
  if (!supabase) throw new Error(socialMessages.sign_in_required);
  const {data,error} = await supabase.auth.getSession();
  if (error || !data.session) throw new Error(socialMessages.sign_in_required);
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${provider}-connector`,{method:'POST',headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({action}),signal:AbortSignal.timeout(60000)});
  const body = await response.json();
  if (!response.ok) throw new Error(socialMessages[body.error] ?? 'The connection could not complete. Please try again.');
  return body;
}
