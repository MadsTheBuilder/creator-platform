import { supabase } from './supabase';
import type { Storyboard } from '../storyboard/composition';

// Jobs run on the Railway worker (see worker/) or the creator's own computer (bridge/). The browser only queues them and reads results.
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type BreakdownJob = { id: string; kind: 'breakdown'; status: JobStatus; input: { script: string; vision: Record<string, unknown>; source?: 'mcp' }; output: Storyboard | null; error: string | null };
export type ScriptJob = { id: string; kind: 'script'; status: JobStatus; input: { idea: string; platform: string; length: number; tone: string }; output: { title: string; script: string } | null; error: string | null };
export type BlockoutJob = { id: string; kind: 'blockout'; status: JobStatus; input: { breakdown_id: string; shots: number[] }; output: { files: string[]; shots: number[] } | null; error: string | null };
export type TranscribeJob = { id: string; kind: 'transcribe'; status: JobStatus; input: { file: string; language: 'hi' | 'en'; writing: 'roman' | 'devanagari' }; output: { file: string; seconds: number; words: number; video: boolean } | { stage: 'converting' } | null; error: string | null };
export type Job = BreakdownJob | ScriptJob | BlockoutJob | TranscribeJob;

const COLUMNS = 'id,kind,status,input,output,error';
function client() { if (!supabase) throw new Error('Sign-in has not been configured for this installation.'); return supabase; }

export async function queueJob<T extends Job>(kind: T['kind'], input: object, projectId?: string): Promise<T> {
  const { data, error } = await client().from('video_jobs').insert({ kind, input, project_id: projectId ?? null }).select(COLUMNS).single();
  if (error) throw new Error('Could not start the job. Please try again.');
  return data as T;
}

export async function getJob<T extends Job>(id: string): Promise<T> {
  const { data, error } = await client().from('video_jobs').select(COLUMNS).eq('id', id).single();
  if (error) throw new Error('Could not check the job. Please try again.');
  return data as T;
}

export async function latestJob<T extends Job>(kind: T['kind'], { projectId }: { projectId?: string } = {}): Promise<T | null> {
  let query = client().from('video_jobs').select(COLUMNS).eq('kind', kind);
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('Could not load your storyboards.');
  return data as T | null;
}


export const active = (job: { status: JobStatus } | null) => job?.status === 'queued' || job?.status === 'running';
