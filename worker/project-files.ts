// Project storage shared by the site's routes (server.ts) and the MCP tools (mcp.ts), so the two can't drift.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildComposition, parseStoryboard, type Storyboard } from '../frontend/src/storyboard/composition.ts';

export const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export const DATA = resolve(process.env.DATA_DIR ?? local('./data'));
const GSAP = local('./node_modules/gsap/dist/gsap.min.js');
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SAFE_NAME = /^\w[\w .()-]{0,120}$/;
export const REFERENCE = /\.(jpe?g|png|webp|gif|mp4|mov|webm)$/i;
export const BLOCKOUT_FILE = /\.(mp4|png|blend|json)$/i;
// Studio track recordings, voiceovers, music and sound effects, in <project>/media/.
export const MEDIA = /\.(mp4|mov|webm|m4a|mp3|wav|aac|ogg)$/i;
export const MB = 1024 * 1024;
const BLANK_MARK = '<!-- playground:blank -->';
const BLANK = `<!doctype html>${BLANK_MARK}
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<script src="gsap.min.js"></script>
<style>body{margin:0;background:#000}#root{position:relative;width:100%;height:100%;overflow:hidden}</style>
</head><body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="10"></div>
<script>window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>
`;

export class UploadError extends Error {}
export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export const projectDir = (user: string, id: string) => join(DATA, 'projects', user, id);

// Does this creator own this project? The service role bypasses RLS, so every caller checks.
const owners = new Map<string, { user: string; until: number }>();
export async function owns(db: SupabaseClient, user: string, project: string | undefined) {
  if (!project || !UUID.test(project)) return false;
  const hit = owners.get(project);
  if (hit && hit.until > Date.now()) return hit.user === user;
  const { data } = await db.from('projects').select('user_id').eq('id', project).maybeSingle();
  if (!data) return false;
  owners.set(project, { user: data.user_id, until: Date.now() + 60_000 });
  return data.user_id === user;
}

// The project folder with a blank composition, created on first use.
export async function ensureProject(user: string, id: string) {
  const dir = projectDir(user, id);
  await mkdir(dir, { recursive: true });
  if (!existsSync(join(dir, 'index.html'))) {
    await writeFile(join(dir, 'index.html'), BLANK);
    await copyFile(GSAP, join(dir, 'gsap.min.js'));
  }
  return dir;
}

export const readComposition = (dir: string) => readFile(join(dir, 'index.html'), 'utf8').catch(() => '');
export const isBlank = (html: string) => html.includes(BLANK_MARK);

// The storyboard as a HyperFrames project folder: index.html plus a local GSAP copy.
export async function writeComposition(dir: string, storyboard: Storyboard) {
  await writeFile(join(dir, 'index.html'), buildComposition(storyboard, 'gsap.min.js'));
  await copyFile(GSAP, join(dir, 'gsap.min.js'));
}

// The newest finished breakdown: what the Shots tab, the Studio seed and the Blender bridge all read.
export async function latestBreakdown(db: SupabaseClient, user: string, project: string) {
  const { data } = await db.from('video_jobs').select('id,output,input,created_at').eq('project_id', project).eq('user_id', user)
    .eq('kind', 'breakdown').eq('status', 'done').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data?.output) return null;
  try { return { id: data.id as string, storyboard: parseStoryboard(data.output), source: data.input?.source === 'mcp' ? 'mcp' : 'site', created_at: data.created_at as string }; }
  catch { return null; }
}

// Reference images and videos per shot, in <project>/references/shot-<n>/ (the editor sees them too).
export function refPath(user: string, id: string, shot: number, name: string) {
  if (!Number.isInteger(shot) || shot < 0 || shot > 999 || !SAFE_NAME.test(name) || !REFERENCE.test(name)) return null;
  return join(projectDir(user, id), 'references', `shot-${shot}`, name);
}
export async function listReferences(user: string, id: string) {
  const root = join(projectDir(user, id), 'references');
  const refs: { shot: number; name: string }[] = [];
  for (const dir of await readdir(root).catch(() => [] as string[])) {
    const shot = Number(dir.match(/^shot-(\d+)$/)?.[1] ?? NaN);
    if (shot >= 0) for (const name of await readdir(join(root, dir))) if (REFERENCE.test(name)) refs.push({ shot, name });
  }
  return refs;
}

// Recordings, music and sound effects in <project>/media/ (the editor sees them too).
export function mediaPath(user: string, id: string, name: string) {
  return SAFE_NAME.test(name) && MEDIA.test(name) ? join(projectDir(user, id), 'media', name) : null;
}
export async function listMedia(user: string, id: string) {
  const dir = join(projectDir(user, id), 'media');
  const names = (await readdir(dir).catch(() => [] as string[])).filter(n => MEDIA.test(n));
  return Promise.all(names.map(async name => ({ name, bytes: (await stat(join(dir, name))).size })));
}
// The Studio track's word timings, written by `hyperframes transcribe` (null until a recording is transcribed).
export type Word = { text: string; start: number; end: number };
export async function readTranscript(user: string, id: string): Promise<Word[] | null> {
  try { const words = JSON.parse(await readFile(join(projectDir(user, id), 'transcript.json'), 'utf8')); return Array.isArray(words) ? words : null; }
  catch { return null; }
}

// Room on the volume for `bytes` more, keeping a margin: a full disk breaks every project on it.
export async function hasRoom(bytes: number) {
  await mkdir(DATA, { recursive: true });
  const fs = await statfs(DATA);
  return fs.bavail * fs.bsize - bytes > 500 * MB;
}

// Stream a request body to disk (never whole in memory), capped at `limit` bytes.
export async function saveBody(req: Request, path: string, limit: number) {
  const tooBig = () => new UploadError(`Files up to ${limit / MB} MB fit.`);
  if (!req.body) throw new UploadError('The upload was empty.');
  if (Number(req.headers.get('content-length')) > limit) throw tooBig();
  let size = 0;
  const cap = new Transform({ transform(chunk, _enc, done) { size += chunk.length; done(size > limit ? tooBig() : null, chunk); } });
  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.part`;
  try { await pipeline(Readable.fromWeb(req.body as never), cap, createWriteStream(part)); await rename(part, path); }
  catch (e) { await rm(part, { force: true }); throw e; }
}

// Tell the open Playground that something in the project folder changed (it listens on projects via Realtime).
export const touchProject = (db: SupabaseClient, id: string) =>
  db.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', id);
