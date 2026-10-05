import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { youtubeRequest, connectorMessages, type YouTubeSnapshot, type YouTubeStatus } from './youtube';
export function useYouTubeOverview() {
  const [snapshot, setSnapshot] = useState<YouTubeSnapshot | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const generation = useRef(0), owner = useRef<string | null>(null), mounted = useRef(false);
  async function refresh() {
    const id = ++generation.current;
    setBusy(true); setError(''); setSnapshot(null);
    try {
      if (!supabase) throw new Error('Google sign-in is not configured.');
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw new Error(connectorMessages.sign_in_required);
      if (id !== generation.current || !mounted.current) return;
      owner.current = data.session.user.id;
      const status = await youtubeRequest<YouTubeStatus>('status');
      if (id !== generation.current || !mounted.current) return;
      if (!status.configured) throw new Error(connectorMessages.setup_required);
      if (!status.connected) throw new Error(connectorMessages.not_connected);
      const next = await youtubeRequest<YouTubeSnapshot>('sync');
      if (id === generation.current && mounted.current) setSnapshot(next);
    } catch (cause) {
      if (id === generation.current && mounted.current) setError(cause instanceof Error ? cause.message : 'Could not load YouTube data.');
    } finally { if (id === generation.current && mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      const nextOwner = session?.user.id ?? null;
      if (owner.current === nextOwner) return;
      owner.current = nextOwner; generation.current++;
      setSnapshot(null); setBusy(true);
      // Avoid awaiting Auth methods inside the Auth callback.
      setTimeout(() => { if (mounted.current) void refresh(); }, 0);
    }).data.subscription;
    return () => { mounted.current = false; generation.current++; subscription?.unsubscribe(); };
  }, []);
  return { snapshot, busy, error, refresh };
}
