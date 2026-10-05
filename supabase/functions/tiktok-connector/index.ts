import { env, serveSocial } from '../_shared/social-runtime.ts';
import { tiktokProvider } from './provider.ts';
serveSocial(tiktokProvider({clientId:env('TIKTOK_CLIENT_KEY'),clientSecret:env('TIKTOK_CLIENT_SECRET'),callbackUrl:`${env('SUPABASE_URL')}/functions/v1/tiktok-connector/callback`,fetch}));
