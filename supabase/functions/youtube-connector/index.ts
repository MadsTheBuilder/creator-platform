import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createConnector } from './core.ts';
import type { Store } from './core.ts';
const env = (name: string) => Deno.env.get(name) ?? '';
const url = env('SUPABASE_URL');
const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
const requireSuccess = (error: unknown) => { if (error) throw new Error('Database operation failed'); };
const store: Store = {
  async get(userId) { const { data, error } = await admin.from('youtube_connections').select('*').eq('user_id', userId).maybeSingle(); requireSuccess(error); return data; },
  async put(connection) { const { error } = await admin.from('youtube_connections').upsert(connection); requireSuccess(error); },
  async refresh(connection, previous) { const { data, error } = await admin.from('youtube_connections').update({ credentials: connection.credentials }).eq('user_id', connection.user_id).eq('credentials', previous).select('user_id'); requireSuccess(error); return !!data?.length; },
  async remove(userId) { const { error } = await admin.from('youtube_connections').delete().eq('user_id', userId); requireSuccess(error); },
  async createState(state) {
    const cleanup = await admin.from('youtube_oauth_states').delete().lt('expires_at', new Date().toISOString()); requireSuccess(cleanup.error);
    const { error } = await admin.from('youtube_oauth_states').insert(state); requireSuccess(error);
  },
  async consumeState(hash) { const { data, error } = await admin.rpc('consume_youtube_state', { p_hash: hash }); requireSuccess(error); return data?.[0] ?? null; },
};
Deno.serve(createConnector({
  store,
  // The shared guest account never connects a channel: every visitor would see it.
  async authenticate(token) { const { data, error } = await admin.auth.getUser(token); return error || data.user?.app_metadata?.guest ? null : data.user?.id ?? null; },
  fetch,
  clientId: env('YOUTUBE_GOOGLE_CLIENT_ID'), clientSecret: env('YOUTUBE_GOOGLE_CLIENT_SECRET'), encryptionKey: env('YOUTUBE_TOKEN_ENCRYPTION_KEY'),
  callbackUrl: `${url}/functions/v1/youtube-connector?action=callback`,
  origins: env('YOUTUBE_APP_ORIGINS').split(',').filter(Boolean),
}));
