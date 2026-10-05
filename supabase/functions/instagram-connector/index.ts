import { env, serveSocial } from '../_shared/social-runtime.ts';
import { instagramProvider } from './provider.ts';
serveSocial(instagramProvider({clientId:env('INSTAGRAM_CLIENT_ID'),clientSecret:env('INSTAGRAM_CLIENT_SECRET'),version:env('INSTAGRAM_GRAPH_VERSION'),callbackUrl:`${env('SUPABASE_URL')}/functions/v1/instagram-connector/callback`,fetch}));
