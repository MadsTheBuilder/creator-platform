import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { socialMessages, socialRequest, type SocialSnapshot, type SocialStatus } from './social';

export function useTikTokOverview() {
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const generation = useRef(0), owner = useRef<string | null>(null), mounted = useRef(false);
  async function refresh() {
    const id = ++generation.current;
    setBusy(true); setError(''); setSnapshot(null);
    try {
      if (!supabase) throw new Error(socialMessages.sign_in_required);
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (id !== generation.current || !mounted.current) return;
      if (sessionError || !data.session) throw new Error(socialMessages.sign_in_required);
      owner.current = data.session.user.id;
      const status = await socialRequest<SocialStatus>('tiktok', 'status');
      if (id !== generation.current || !mounted.current) return;
      if (!status.configured) throw new Error(socialMessages.setup_required);
      if (!status.connected) throw new Error(socialMessages.not_connected);
      const next = await socialRequest<SocialSnapshot>('tiktok', 'sync');
      if (id === generation.current && mounted.current) setSnapshot(next);
    } catch (cause) {
      if (id === generation.current && mounted.current) setError(cause instanceof Error ? cause.message : 'Could not load TikTok data.');
    } finally { if (id === generation.current && mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      const nextOwner = session?.user.id ?? null;
      if (owner.current === nextOwner) return;
      owner.current = nextOwner; generation.current++;
      setSnapshot(null); setBusy(true); setError('');
      setTimeout(() => { if (mounted.current) void refresh(); }, 0);
    }).data.subscription;
    return () => { mounted.current = false; generation.current++; subscription?.unsubscribe(); };
  }, []);
  return { snapshot, busy, error, refresh };
}
