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
