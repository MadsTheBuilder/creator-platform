import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildComposition, parseStoryboard } from '../frontend/src/storyboard/composition.ts';

const run = promisify(execFile);
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const HYPERFRAMES = local('./node_modules/hyperframes/bin/hyperframes.mjs');
const GSAP = local('./node_modules/gsap/dist/gsap.min.js');

// Build the composition from the storyboard (never from browser-supplied HTML), render it with
// HyperFrames, and store the MP4 under the creator's folder.
export async function render(db: SupabaseClient, job: { id: string; user_id: string; input: { storyboard?: unknown } }) {
  const storyboard = parseStoryboard(job.input.storyboard);
  const dir = await mkdtemp(join(tmpdir(), 'hf-'));
  try {
    await writeFile(join(dir, 'index.html'), buildComposition(storyboard, 'gsap.min.js'));
    await copyFile(GSAP, join(dir, 'gsap.min.js'));
    const out = join(dir, 'out.mp4');
    await run(process.execPath, [HYPERFRAMES, 'render', '--output', out], { cwd: dir, timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    const path = `${job.user_id}/${job.id}.mp4`;
    const { error } = await db.storage.from('renders').upload(path, await readFile(out), { contentType: 'video/mp4', upsert: true });
    if (error) throw error;
    return { path };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
