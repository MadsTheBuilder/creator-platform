import { useEffect, useState } from 'react';
import { Plugs, VideoCamera } from '@phosphor-icons/react';
import type { OAuthAuthorizationDetails, User } from '@supabase/supabase-js';
import { supabase } from '../data/supabase';
import { Button, Notice } from '../components/ui';

// Supabase Auth's OAuth server sends Claude / Codex sign-ins here (/oauth/consent?authorization_id=...).
// Signing in first returns to the site root, which brings the creator back here (see main.tsx).
export const CONSENT_RETURN = 'oauth-consent-return';

export function OAuthConsent() {
  const id = new URLSearchParams(window.location.search).get('authorization_id') ?? '';
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(id ? '' : 'This sign-in link is incomplete. Start the connection again from Claude or Codex.');

  useEffect(() => {
    if (!supabase) { setError('Sign-in has not been configured for this installation.'); return; }
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
  }, []);

  useEffect(() => {
    if (!user || !id || !supabase) return;
    supabase.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (error || !data) { setError('This sign-in request has expired. Start the connection again from Claude or Codex.'); return; }
      if ('authorization_id' in data) setDetails(data);
      else window.location.replace(data.redirect_url); // consented before
    });
  }, [user, id]);

  async function signIn() {
    sessionStorage.setItem(CONSENT_RETURN, window.location.href);
    setBusy(true);
    const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/`, scopes: 'openid email profile' } });
    if (error) { setError(error.message); setBusy(false); }
  }

  async function decide(approve: boolean) {
    setBusy(true); setError('');
    const { data, error } = approve ? await supabase!.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true }) : await supabase!.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
    if (error || !data?.redirect_url) { setError('That did not go through. Please try again.'); setBusy(false); return; }
    window.location.replace(data.redirect_url);
  }

  const name = details?.client.name || 'An app';
  const back = details ? new URL(details.redirect_uri).host : '';
  return <div className="consent-page"><section className="glass consent-card" aria-labelledby="consent-title">
    <p className="brand"><VideoCamera size={18} weight="fill" aria-hidden/>Content Engine</p>
    {error ? <Notice>{error}</Notice>
      : user === null ? <>
        <h1 id="consent-title">Connect an AI assistant</h1>
        <p>Sign in with the Google account you use for Content Engine to continue.</p>
        <Button className="primary" disabled={busy} onClick={signIn}>Sign in with Google</Button>
      </>
      : !details ? <p aria-live="polite">Loading…</p>
      : <>
        <Plugs size={28} aria-hidden/>
        <h1 id="consent-title">{name} wants to work on your projects</h1>
        <p>It will be able to read and change your Playground projects as <strong>{user?.email}</strong>: scripts, shot breakdowns, the Studio edit, references and Blender blockouts. It can't see your channel connections or sign-in.</p>
        <p className="consent-meta">Returns to <strong>{back}</strong>. You can disconnect it at any time from Connections.</p>
        <div className="consent-actions">
          <Button disabled={busy} onClick={() => decide(false)}>Deny</Button>
          <Button className="primary" disabled={busy} onClick={() => decide(true)}>Allow</Button>
        </div>
      </>}
  </section></div>;
}
