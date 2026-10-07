// Project storage shared by the site's routes (server.ts) and the MCP tools (mcp.ts), so the two can't drift.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
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
// AI video takes (Production), generated from the project's prompts, in <project>/takes/.
export const TAKE = /\.(mp4|mov|webm)$/i;
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
    if (shot >= 0) for (const name of await readdir(join(root, dir))) if (REFERENCE.test(name) && !name.startsWith('.')) refs.push({ shot, name });
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
// Generated AI video takes, newest first (the editor sees them too).
export function takePath(user: string, id: string, name: string) {
  return SAFE_NAME.test(name) && TAKE.test(name) ? join(projectDir(user, id), 'takes', name) : null;
}
export async function listTakes(user: string, id: string) {
  const dir = join(projectDir(user, id), 'takes');
  const names = (await readdir(dir).catch(() => [] as string[])).filter(n => TAKE.test(n) && !n.startsWith('.'));
  const takes = await Promise.all(names.map(async name => { const info = await stat(join(dir, name)); return { name, bytes: info.size, at: info.mtimeMs }; }));
  return takes.sort((a, b) => b.at - a.at).map(({ name, bytes }) => ({ name, bytes }));
}
// The AI video prompts the creator's Claude saved (save_prompts), or null.
export const readPrompts = (user: string, id: string) => readFile(join(projectDir(user, id), 'ai-video', 'prompts.md'), 'utf8').catch(() => null);
// The blockout video those prompts follow (save_prompts records it): what each take is compared against.
export const readPromptBlockout = (user: string, id: string) => readFile(join(projectDir(user, id), 'ai-video', 'source.json'), 'utf8')
  .then(text => (JSON.parse(text).blockout as string | undefined) ?? null).catch(() => null);

// Studio track: the beat board, one key frame per beat of the approved plan, which the creator annotates on the
// Build step before the full build (snapshot_board writes it, get_board reads the notes back).
export type Board = { round: number; made_at: string; frames: { beat: string; at: number; file: string; note?: string }[]; note?: string; notes_at?: string };
export const readBoard = (user: string, id: string): Promise<Board | null> =>
  readFile(join(projectDir(user, id), 'board', 'board.json'), 'utf8').then(JSON.parse).catch(() => null);
export async function writeBoard(user: string, id: string, board: Board) {
  const file = join(projectDir(user, id), 'board', 'board.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.part`, JSON.stringify(board, null, 1));
  await rename(`${file}.part`, file);
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

// Stream a request body (or any stream) to disk (never whole in memory), capped at `limit` bytes.
export async function saveBody(req: Request | Readable, path: string, limit: number) {
  const tooBig = () => new UploadError(`Files up to ${limit / MB} MB fit.`);
  let body: Readable;
  if (req instanceof Readable) body = req;
  else {
    if (!req.body) throw new UploadError('The upload was empty.');
    if (Number(req.headers.get('content-length')) > limit) throw tooBig();
    body = Readable.fromWeb(req.body as never);
  }
  let size = 0;
  const cap = new Transform({ transform(chunk, _enc, done) { size += chunk.length; done(size > limit ? tooBig() : null, chunk); } });
  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.part`;
  try { await pipeline(body, cap, createWriteStream(part)); await rename(part, path); }
  catch (e) { await rm(part, { force: true }); throw e; }
}

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };
export const mimeOf = (path: string) => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

// A file from disk with byte ranges, so videos can seek.
export async function sendFile(path: string, range: string | undefined) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const headers: Record<string, string> = { 'Content-Type': mimeOf(path), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache' };
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || !(m[1] || m[2])) return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: { ...headers, 'Content-Length': String(info.size) } });
  const start = m[1] ? Number(m[1]) : Math.max(info.size - Number(m[2]), 0);
  const end = m[1] && m[2] ? Math.min(Number(m[2]), info.size - 1) : info.size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
  return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${info.size}` } });
}

// Tell the open Playground that something in the project folder changed (it listens on projects via Realtime).
export const touchProject = (db: SupabaseClient, id: string) =>
  db.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', id);
