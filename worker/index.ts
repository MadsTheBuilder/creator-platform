import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { setTimeout as sleep } from 'node:timers/promises';
import { breakdown } from './breakdown.ts';
import { JobError } from './job-error.ts';
import { script } from './script.ts';
import { startServer } from './server.ts';
import { transcribe } from './transcribe.ts';

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SECRET_KEY and ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN).');
}
const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const claude = new Anthropic();
// Blockouts are claimed by the creator's own PC (the Blender bridge), never here.
// ponytail: one loop, so a long transcription delays scripts and breakdowns; give it its own loop if that hurts.
const KINDS = ['breakdown', 'script', 'transcribe'];

async function finish(id: string, fields: { status: 'done' | 'failed'; output?: unknown; error?: string }) {
  const { error } = await db.from('video_jobs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) console.error(`could not finish job ${id}`, error);
}

// One job at a time. Returns false when the queue is empty.
async function next(): Promise<boolean> {
  const { data, error } = await db.rpc('claim_video_job', { p_kinds: KINDS });
  if (error) throw error;
  const job = data?.[0];
  if (!job) return false;
  console.log(`job ${job.id} ${job.kind} started`);
  try {
    const output = job.kind === 'breakdown' ? await breakdown(claude, job.input) : job.kind === 'transcribe' ? await transcribe(job) : await script(claude, job.input);
    await finish(job.id, { status: 'done', output });
    console.log(`job ${job.id} done`);
  } catch (cause) {
    console.error(`job ${job.id} failed`, cause);
    await finish(job.id, { status: 'failed', error: cause instanceof JobError ? cause.message : 'Something went wrong on our side. Please try again.' });
  }
  return true;
}

// A job left "running" by a previous container never finishes, so fail it on startup.
// ponytail: assumes a single worker; give jobs a worker id + heartbeat before scaling out.
await db.from('video_jobs').update({ status: 'failed', error: 'Interrupted by a worker restart. Please try again.', updated_at: new Date().toISOString() }).eq('status', 'running').in('kind', KINDS);
startServer(db, Number(process.env.PORT ?? 8787));
console.log('video worker ready');
for (;;) {
  try { if (!(await next())) await sleep(3000); }
  catch (cause) { console.error('queue error', cause); await sleep(10_000); }
}
