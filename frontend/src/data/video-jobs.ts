import { supabase } from './supabase';
import type { Storyboard } from '../storyboard/composition';

// Jobs run on the Railway worker (see worker/). The browser only queues them and reads results.
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type BreakdownJob = { id: string; kind: 'breakdown'; status: JobStatus; input: { script: string; vision: Record<string, unknown> }; output: Storyboard | null; error: string | null };
export type RenderJob = { id: string; kind: 'render'; status: JobStatus; input: { breakdown_id: string; storyboard: Storyboard }; output: { path: string } | null; error: string | null };
type Job = BreakdownJob | RenderJob;

const COLUMNS = 'id,kind,status,input,output,error';
function client() { if (!supabase) throw new Error('Sign-in has not been configured for this installation.'); return supabase; }

export async function queueJob<T extends Job>(kind: T['kind'], input: object): Promise<T> {
  const { data, error } = await client().from('video_jobs').insert({ kind, input }).select(COLUMNS).single();
  if (error) throw new Error('Could not start the job. Please try again.');
  return data as T;
}

export async function getJob<T extends Job>(id: string): Promise<T> {
  const { data, error } = await client().from('video_jobs').select(COLUMNS).eq('id', id).single();
  if (error) throw new Error('Could not check the job. Please try again.');
  return data as T;
}

export async function latestJob<T extends Job>(kind: T['kind'], breakdownId?: string): Promise<T | null> {
  let query = client().from('video_jobs').select(COLUMNS).eq('kind', kind);
  if (breakdownId) query = query.eq('input->>breakdown_id', breakdownId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('Could not load your storyboards.');
  return data as T | null;
}

export async function renderUrl(path: string, filename: string): Promise<string> {
  const { data, error } = await client().storage.from('renders').createSignedUrl(path, 60 * 60, { download: filename });
  if (error) throw new Error('Could not load the video.');
  return data.signedUrl;
}

export const active = (job: Job | null) => job?.status === 'queued' || job?.status === 'running';
