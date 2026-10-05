import { createClient } from '@supabase/supabase-js';

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
