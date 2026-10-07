import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { active, getJob, type Job } from './video-jobs';
import { syncSession } from './app-server';

const POLL_MS = 4000;

// undefined while checking, null when signed out.
export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  return session;
}

// Poll a job until the worker finishes it.
export function usePolled<T extends Job>(job: T | null, setJob: (job: T) => void, setError: (e: string) => void) {
  useEffect(() => {
    if (!active(job)) return;
    const timer = setInterval(() => { getJob<T>(job!.id).then(setJob, e => setError(e.message)); }, POLL_MS);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
}

// Counts changes to a project made anywhere else (another tab, the creator's Claude / Codex over MCP):
// its row (script, name, files touched) and its jobs. Add it to an effect's deps to refetch.
export function useProjectChanges(projectId: string | undefined) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!supabase || !projectId) return;
    const bump = () => setVersion(v => v + 1);
    // A unique name per hook: several components watch the same project, and supabase-js hands a
    // repeated name back as the already-subscribed channel, which then throws on .on().
    const channel = supabase.channel(`project-${projectId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'video_jobs', filter: `project_id=eq.${projectId}` }, bump)
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [projectId]);
  return version;
}

// Counts changes to the creator's plan made anywhere else (another tab, later Trends). Same channel
// naming rule as useProjectChanges.
export function usePlanChanges(userId: string | undefined) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase.channel(`plan-${userId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_items', filter: `user_id=eq.${userId}` }, () => setVersion(v => v + 1))
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [userId]);
  return version;
}

// Counts changes to the creator's styles made anywhere else (another tab, their Claude over MCP).
export function useStyleChanges(userId: string | undefined) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!supabase || !userId) return;
    const bump = () => setVersion(v => v + 1);
    const channel = supabase.channel(`styles-${userId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'creator_styles', filter: `user_id=eq.${userId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'creator_style_files', filter: `user_id=eq.${userId}` }, bump)
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [userId]);
  return version;
}

// Keep the app server's session cookie in step with Supabase. 'ready', 'connecting' or an error.
export function useAppServer() {
  const [state, setState] = useState('connecting');
  useEffect(() => {
    let live = true;
    const sync = () => syncSession().then(() => live && setState('ready'), e => live && setState(e.message));
    sync();
    const subscription = supabase?.auth.onAuthStateChange(event => { if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') sync(); }).data.subscription;
    return () => { live = false; subscription?.unsubscribe(); };
  }, []);
  return state;
}
