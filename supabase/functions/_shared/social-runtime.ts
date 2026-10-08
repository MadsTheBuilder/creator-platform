import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createSocialConnector } from './social-core.ts';
import type { Provider, Store } from './social-core.ts';
export const env = (name: string) => (Deno.env.get(name) ?? '').trim();
export function serveSocial(provider: Provider) {
  const admin = createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  const check = (error: unknown) => { if (error) throw new Error('Database operation failed'); };
  const store: Store = {
    async get(user) { const {data,error} = await admin.from('social_connections').select('*').eq('provider',provider.name).eq('user_id',user).maybeSingle(); check(error); return data; },
    async put(connection) { const {error} = await admin.from('social_connections').upsert(connection,{onConflict:'provider,user_id'}); check(error); },
    async refresh(connection,previous) { const {data,error} = await admin.from('social_connections').update({credentials:connection.credentials}).eq('provider',provider.name).eq('user_id',connection.user_id).eq('credentials',previous).select('user_id'); check(error); return !!data?.length; },
    async remove(user) {
      const states = await admin.from('social_oauth_states').delete().eq('provider',provider.name).eq('user_id',user); check(states.error);
      const {error} = await admin.from('social_connections').delete().eq('provider',provider.name).eq('user_id',user); check(error);
    },
    async createState(state) {
      const cleanup = await admin.from('social_oauth_states').delete().lt('expires_at',new Date().toISOString()); check(cleanup.error);
      const {error} = await admin.from('social_oauth_states').insert(state); check(error);
    },
    async consumeState(hash) { const {data,error} = await admin.rpc('consume_social_state',{p_provider:provider.name,p_hash:hash}); check(error); return data?.[0] ?? null; },
  };
  // The shared guest account never connects a channel: every visitor would see it.
  Deno.serve(createSocialConnector({store,provider,encryptionKey:env('SOCIAL_TOKEN_ENCRYPTION_KEY') || env('YOUTUBE_TOKEN_ENCRYPTION_KEY'),origins:(env('SOCIAL_APP_ORIGINS') || env('YOUTUBE_APP_ORIGINS')).split(',').map(value=>value.trim()).filter(Boolean),async authenticate(token) {const {data,error} = await admin.auth.getUser(token); return error || data.user?.app_metadata?.guest ? null : data.user?.id ?? null;}}));
}
