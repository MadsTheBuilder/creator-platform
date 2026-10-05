import { supabase } from './supabase';

// The app server (worker/server.ts) hosts the HyperFrames editor. The editor loads in an iframe,
// which can't send a bearer token, so the server keeps the Supabase access token in a cookie.
export async function syncSession() {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  if (!data.session) throw new Error('Sign in again to open the editor.');
  const res = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: data.session.access_token }) });
  if (!res.ok) throw new Error('The editor server is not reachable. Please try again in a moment.');
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? 'Something went wrong. Please try again.');
  return body as T;
}
