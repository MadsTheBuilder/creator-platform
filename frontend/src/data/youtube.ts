import { supabase } from './supabase';
export type YouTubeStatus = { configured: boolean; connected: boolean; channel: { id: string; title: string; connectedAt?: string } | null };
export type YouTubeSnapshot = {
  source: string; observedAt: string; window: { startDate: string; endDate: string };
  channel: { id: string; title: string; picture?: string | null; statistics: Record<string, string | boolean> };
  videos: { id: string; title: string; publishedAt: string; thumbnail?: string | null; statistics: Record<string, string | boolean>; insights?: Record<string, number> | null }[];
  analytics: { columnHeaders?: { name: string }[]; rows?: (string | number)[][] } | null;
  analyticsError: string | null; retention: null;
};
export const connectorMessages: Record<string, string> = {
  sign_in_required: 'Sign in with Google to connect your channel.',
  setup_required: 'YouTube connection is awaiting Google API configuration.',
  consent_cancelled: 'YouTube consent was cancelled. You can try again whenever you are ready.',
  missing_permissions: 'Both read-only YouTube permissions are needed. Please reconnect and approve them.',
  no_channel: 'No YouTube channel was found. Try the Google or Brand account that owns your channel.',
  reconnect_required: 'YouTube access has expired or was revoked. Please reconnect.',
  connection_changed_retry: 'The connection changed in another tab. Reload Connections and try again.',
  channel_access_changed: 'The connected channel is no longer accessible. Please reconnect.',
  quota_exceeded: 'YouTube API quota is exhausted. Please try again later.',
  provider_permissions_or_api_disabled: 'YouTube could not return this data. Check API activation and granted permissions.',
  provider_unavailable: 'YouTube did not respond. Please try again later.',
  not_connected: 'Connect your YouTube channel first.',
  offline_access_required: 'Google did not grant renewable access. Please reconnect.',
  connected: 'Your YouTube channel is connected. Refresh to load its real data.',
};
export async function youtubeRequest<T>(action: 'status' | 'start' | 'sync' | 'disconnect'): Promise<T> {
  if (!supabase) throw new Error('Account sign-in is not configured.');
  const { data: session, error } = await supabase.auth.getSession();
  if (error || !session.session) throw new Error(connectorMessages.sign_in_required);
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/youtube-connector`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.session.access_token}` },
    body: JSON.stringify({ action }), signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(connectorMessages[data.error] ?? 'The channel connection is unavailable. Please try again.');
  return data;
}
