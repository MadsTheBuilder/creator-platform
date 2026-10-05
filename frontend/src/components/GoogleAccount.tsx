import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { googleSignInAvailable, supabase } from '../data/supabase';
import { Button, Notice } from './ui';

export function GoogleAccount() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const client = supabase;
    if (!client) { setReady(true); return; }
    let active = true;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setUser(session?.user ?? null);
    });
    async function load() {
      try {
        const { data, error: sessionError } = await client!.auth.getSession();
        if (sessionError) throw sessionError;
        if (active) setUser(data.session?.user ?? null);
        const available = await googleSignInAvailable();
        if (active) setEnabled(available);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load your account.');
      } finally { if (active) setReady(true); }
    }
    void load();
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function signIn() {
    if (!supabase) return;
    setBusy(true); setError('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/`, scopes: 'openid email profile' },
      });
      if (error) throw error;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true); setError('');
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setUser(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-out failed. Please try again.'); }
    finally { setBusy(false); }
  }

  return <section className="glass connection-detail" aria-label="Content Engine account">
    <h2>Your Content Engine account</h2>
    <p>Sign in with Google to identify your account. Channel connections have their own permissions.</p>
    {!supabase ? <Notice>Account sign-in has not been configured for this installation.</Notice>
      : !ready ? <p role="status">Checking your account…</p>
      : user ? <><p>Signed in as {user.email ?? 'Google user'}</p><Button disabled={busy} onClick={signOut}>Sign out</Button></>
      : <><Button className="primary" disabled={!enabled || busy} onClick={signIn}>Continue with Google</Button>
        {!enabled && !error && <Notice>Google sign-in is awaiting setup. Enable the Google provider in Supabase to continue.</Notice>}</>}
    {error && <p role="alert">{error}</p>}
    <p className="muted">Projects currently remain saved in this browser. Signing in does not upload them or connect a channel.</p>
  </section>;
}
