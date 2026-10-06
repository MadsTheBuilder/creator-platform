import { useEffect, useState } from 'react';
import type { OAuthGrant } from '@supabase/supabase-js';
import { supabase } from '../data/supabase';
import { useSession } from '../data/hooks';
import { Button, Notice } from './ui';

// The platform's MCP server (worker/mcp.ts): the creator's own Claude or Codex works on their projects.
export function AssistantConnection() {
  const session = useSession();
  const [grants, setGrants] = useState<OAuthGrant[] | null>(null);
  const [error, setError] = useState('');
  const url = `${window.location.origin}/mcp`;

  function load() {
    supabase?.auth.oauth.listGrants().then(({ data, error }) => error ? setGrants([]) : setGrants(data));
  }
  useEffect(() => { if (session) load(); }, [session?.user.id]);

  async function revoke(clientId: string) {
    setError('');
    const { error } = await supabase!.auth.oauth.revokeGrant({ clientId });
    if (error) setError('Could not disconnect it. Please try again.'); else load();
  }

  return <section className="glass connection-detail" aria-label="AI assistants">
    <h2>Claude & Codex</h2>
    <p>Let your own Claude or Codex write scripts, shot breakdowns and edits straight into your Playground projects. You approve it once with this account; everything it saves shows up here live.</p>
    <div className="assistant-setup">
      <strong>Claude Code</strong><code>claude mcp add --transport http creator {url}</code>
      <strong>Codex</strong><code>codex mcp add creator --url {url}{'\n'}codex mcp login creator</code>
      <strong>Claude.ai or Claude Desktop</strong><code>Settings → Connectors → Add custom connector → {url}</code>
      <small>Or install the creator-platform plugin, which adds this connection plus skills for each step.</small>
    </div>
    {session && grants && grants.length > 0 && <ul className="assistant-grants" aria-label="Connected assistants">
      {grants.map(g => <li key={g.client.id}><span>{g.client.name || 'Unnamed app'}<small>Connected {new Date(g.granted_at).toLocaleDateString()}</small></span><Button onClick={() => revoke(g.client.id)}>Disconnect</Button></li>)}
    </ul>}
    {error && <Notice>{error}</Notice>}
  </section>;
}
