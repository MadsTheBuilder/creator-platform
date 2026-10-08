import { createClient, type Session } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && key ? createClient(url, key, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
}) : null;

export async function googleSignInAvailable(): Promise<boolean> {
  if (!supabase) return false;
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  if (!response.ok) throw new Error('Could not check sign-in availability. Please try again.');
  const settings = await response.json();
  return settings.external?.google === true;
}

// The shared guest account (worker/guest-reset.ts): everyone with the #guest link signs in as it.
export const isGuest = (session: Session | null | undefined) => session?.user.app_metadata?.guest === true;

export async function signInAsGuest() {
  if (!supabase) throw new Error('Account sign-in has not been configured for this installation.');
  const res = await fetch('/api/guest', { method: 'POST' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? 'The guest account is not available right now.');
  const { error } = await supabase.auth.setSession(body);
  if (error) throw error;
}
