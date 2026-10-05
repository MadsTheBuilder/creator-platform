import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SupabaseClient } from '@supabase/supabase-js';
// ponytail: the CLI's own `hyperframes preview` server, deep-imported. The chunk name changes with
// every HyperFrames release, so bump it together with the pinned version (0.8.134).
import { createStudioServer } from 'hyperframes/dist/studioServer-PXNJXHMV.js';
import { buildComposition, parseStoryboard, type Storyboard } from '../frontend/src/storyboard/composition.ts';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const DATA = resolve(process.env.DATA_DIR ?? local('./data'));
const SITE = local('../frontend/dist');
const STUDIO_UI = local('./node_modules/hyperframes/dist/studio');
const GSAP = local('./node_modules/gsap/dist/gsap.min.js');
const COOKIE = 'hf_session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
const BRIDGE_KIT = local('../bridge');
const SAFE_NAME = /^\w[\w .()-]{0,120}$/;
const REFERENCE = /\.(jpe?g|png|webp|gif|mp4|mov|webm)$/i;
const BLOCKOUT_FILE = /\.(mp4|png|blend|json)$/i;
const MB = 1024 * 1024;
const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };

type Env = { Variables: { user: string } };

// The storyboard as a HyperFrames project folder: index.html plus a local GSAP copy.
async function writeComposition(dir: string, storyboard: Storyboard) {
  await writeFile(join(dir, 'index.html'), buildComposition(storyboard, 'gsap.min.js'));
  await copyFile(GSAP, join(dir, 'gsap.min.js'));
}
type Shot = Record<string, unknown>;
class UploadError extends Error {}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// Stream a request body to disk (never whole in memory), capped at `limit` bytes.
async function saveBody(req: Request, path: string, limit: number) {
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

// A file from disk with byte ranges, so videos can seek.
async function sendFile(path: string, range: string | undefined) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const headers: Record<string, string> = { 'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache' };
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || !(m[1] || m[2])) return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: { ...headers, 'Content-Length': String(info.size) } });
  const start = m[1] ? Number(m[1]) : Math.max(info.size - Number(m[2]), 0);
  const end = m[1] && m[2] ? Math.min(Number(m[2]), info.size - 1) : info.size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
  return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${info.size}` } });
}

export function startServer(db: SupabaseClient, port: number) {
  // Access token -> creator id, re-checked with Supabase every few minutes.
  const users = new Map<string, { id: string; until: number }>();
  async function userFor(token: string | undefined) {
    if (!token) return null;
    const hit = users.get(token);
    if (hit && hit.until > Date.now()) return hit.id;
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) { users.delete(token); return null; }
    users.set(token, { id: data.user.id, until: Math.min(tokenExpiry(token), Date.now() + 5 * 60_000) });
    return data.user.id;
  }

  const owners = new Map<string, { user: string; until: number }>();
  async function owns(user: string, project: string | undefined) {
    if (!project || !UUID.test(project)) return false;
    const hit = owners.get(project);
    if (hit && hit.until > Date.now()) return hit.user === user;
    const { data } = await db.from('projects').select('user_id').eq('id', project).maybeSingle();
    if (!data) return false;
    owners.set(project, { user: data.user_id, until: Date.now() + 60_000 });
    return data.user_id === user;
  }

  // One HyperFrames Studio server per open project, on the volume at <DATA>/projects/<user>/<id>.
  // ponytail: never evicted (each holds a file watcher); evict idle ones if memory gets tight.
  const studios = new Map<string, Promise<ReturnType<typeof createStudioServer>>>();
  const projectDir = (user: string, id: string) => join(DATA, 'projects', user, id);
  function studioFor(user: string, id: string) {
    let studio = studios.get(id);
    if (!studio) {
      studio = (async () => {
        const dir = projectDir(user, id);
        await mkdir(dir, { recursive: true });
        if (!existsSync(join(dir, 'index.html'))) {
          await writeFile(join(dir, 'index.html'), BLANK);
          await copyFile(GSAP, join(dir, 'gsap.min.js'));
        }
        return createStudioServer({ projectDir: dir, projectName: id, historyRoot: join(DATA, 'history') });
      })();
      studios.set(id, studio);
      studio.catch(() => studios.delete(id));
    }
    return studio;
  }

  // The Studio UI calls some routes without a project id (runtime, events, render progress);
  // the page that made the request names it.
  function projectFromReferer(c: Context) {
    const ref = c.req.header('referer');
    try { return ref ? new URL(ref).pathname.match(/^\/(?:studio|api\/projects)\/([0-9a-f-]{36})(?:\/|$)/)?.[1] : undefined; }
    catch { return undefined; }
  }

  async function toStudio(c: Context<Env>, id: string | undefined, request: Request = c.req.raw) {
    if (!await owns(c.get('user'), id)) return c.json({ error: 'not found' }, 404);
    const studio = await studioFor(c.get('user'), id!);
    return studio.app.fetch(request);
  }

  async function file(root: string, path: string) {
    const full = resolve(root, '.' + decodeURIComponent(path));
    if (full !== root && !full.startsWith(root + sep)) return null;
    try { return new Response(await readFile(full), { headers: { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream', 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' } }); }
    catch { return null; }
  }

  const app = new Hono<Env>();

  app.post('/api/session', async c => {
    const { access_token } = await c.req.json().catch(() => ({}));
    if (typeof access_token !== 'string' || !await userFor(access_token)) return c.json({ error: 'Sign in again.' }, 401);
    setCookie(c, COOKIE, access_token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: Math.max(60, Math.floor((tokenExpiry(access_token) - Date.now()) / 1000)) });
    return c.json({ ok: true });
  });
  app.delete('/api/session', c => { deleteCookie(c, COOKIE, { path: '/' }); return c.json({ ok: true }); });

  // Everything else under /api and /studio needs a signed-in creator.
  const signedIn = async (c: Context<Env>, next: () => Promise<void>) => {
    const user = await userFor(getCookie(c, COOKIE));
    if (!user) return c.json({ error: 'Sign in again.' }, 401);
    c.set('user', user);
    await next();
  };
  app.use('/api/*', signedIn);
  app.use('/studio/*', signedIn);

  // Start the project's edit from its latest storyboard, unless it has already been edited.
  app.post('/api/playground/:id/seed', async c => {
    const id = c.req.param('id');
    if (!await owns(c.get('user'), id)) return c.json({ error: 'not found' }, 404);
    const dir = projectDir(c.get('user'), id);
    await studioFor(c.get('user'), id);
    const index = await readFile(join(dir, 'index.html'), 'utf8').catch(() => '');
    if (!index.includes(BLANK_MARK)) return c.json({ seeded: false });
    const { data } = await db.from('video_jobs').select('output').eq('project_id', id).eq('kind', 'breakdown').eq('status', 'done')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!data?.output) return c.json({ seeded: false });
    await writeComposition(dir, parseStoryboard(data.output));
    return c.json({ seeded: true });
  });

  // Reference images and videos per shot, in <project>/references/shot-<n>/ (the editor sees them too).
  const refPath = (c: Context<Env>) => {
    const shot = Number(c.req.param('shot')), name = c.req.param('name') ?? '';
    if (!Number.isInteger(shot) || shot < 1 || shot > 999 || !SAFE_NAME.test(name) || !REFERENCE.test(name)) return null;
    return join(projectDir(c.get('user'), c.req.param('id')!), 'references', `shot-${shot}`, name);
  };
  app.get('/api/playground/:id/references', async c => {
    if (!await owns(c.get('user'), c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    const root = join(projectDir(c.get('user'), c.req.param('id')), 'references');
    const refs: { shot: number; name: string }[] = [];
    for (const dir of await readdir(root).catch(() => [] as string[])) {
      const shot = Number(dir.match(/^shot-(\d+)$/)?.[1]);
      if (shot) for (const name of await readdir(join(root, dir))) if (REFERENCE.test(name)) refs.push({ shot, name });
    }
    return c.json(refs);
  });
  app.put('/api/playground/:id/references/:shot/:name', async c => {
    if (!await owns(c.get('user'), c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    const path = refPath(c);
    if (!path) return c.json({ error: 'Images (JPG, PNG, WebP, GIF) and videos (MP4, MOV, WebM) only, with a plain file name.' }, 400);
    try { await saveBody(c.req.raw, path, 200 * MB); }
    catch (e) { return c.json({ error: e instanceof UploadError ? e.message : 'The upload failed. Please try again.' }, 400); }
    return c.json({ ok: true });
  });
  app.delete('/api/playground/:id/references/:shot/:name', async c => {
    const path = await owns(c.get('user'), c.req.param('id')) ? refPath(c) : null;
    if (!path) return c.json({ error: 'not found' }, 404);
    await rm(path, { force: true });
    return c.json({ ok: true });
  });
  app.get('/api/playground/:id/file/*', async c => {
    const id = c.req.param('id');
    if (!await owns(c.get('user'), id)) return c.json({ error: 'not found' }, 404);
    const root = projectDir(c.get('user'), id);
    const full = resolve(root, '.' + decodeURIComponent(c.req.path.slice(`/api/playground/${id}/file`.length)));
    if (!full.startsWith(root + sep)) return c.json({ error: 'not found' }, 404);
    return await sendFile(full, c.req.header('range')) ?? c.json({ error: 'not found' }, 404);
  });

  // Pair a creator's PC: a new device key, delivered inside the helper download.
  app.post('/api/bridge/pair', async c => {
    const token = randomBytes(32).toString('base64url');
    const { error } = await db.from('bridge_devices').insert({ user_id: c.get('user'), token_hash: sha256(token) });
    if (error) return c.json({ error: 'Could not connect a new computer. Please try again.' }, 500);
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
    const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.slice(0, -1);
    const zip = new AdmZip();
    for (const name of ['creator_bridge.py', 'blockout.py', 'start-windows.bat', 'README.txt']) zip.addLocalFile(join(BRIDGE_KIT, name), 'creator-bridge');
    zip.addFile('creator-bridge/config.json', Buffer.from(JSON.stringify({ server: `${proto}://${host}`, token }, null, 2)));
    return new Response(new Uint8Array(zip.toBuffer()), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="creator-bridge.zip"', 'Cache-Control': 'no-store' } });
  });
  app.get('/api/bridge/devices', async c => {
    const { data, error } = await db.from('bridge_devices').select('id,name,created_at,last_seen').eq('user_id', c.get('user')).order('created_at');
    return error ? c.json({ error: 'Could not load your computers.' }, 500) : c.json(data);
  });
  app.delete('/api/bridge/devices/:device', async c => {
    await db.from('bridge_devices').delete().eq('id', c.req.param('device')).eq('user_id', c.get('user'));
    return c.json({ ok: true });
  });

  // Studio routes that would reach past the project: the desktop-app handoff runs on this
  // machine, and the global asset library is shared by every creator.
  app.post('/api/open-in-desktop', c => c.json({ opened: false, reason: 'handoff-unavailable' }));
  app.get('/api/open-in-desktop', c => c.json({ available: false, handoff: false, downloadUrl: null }));
  app.get('/api/assets/global', c => c.json({ assets: [] }));

  app.all('/api/projects/:id', c => toStudio(c, c.req.param('id')));
  app.all('/api/projects/:id/*', c => toStudio(c, c.req.param('id')));
  app.all('/api/*', c => toStudio(c, projectFromReferer(c)));
  app.get('/studio/:id', c => c.redirect(`/studio/${c.req.param('id')}/`));
  app.get('/studio/:id/', async c => {
    const res = await toStudio(c, c.req.param('id'), new Request(new URL('/', c.req.url), { headers: c.req.raw.headers }));
    if (!res.headers.get('content-type')?.includes('text/html')) return res;
    // Open in the dark theme to match the app, unless the creator picked one.
    const dark = `<script>try{var k="hf-studio-ui-preferences",p=JSON.parse(localStorage.getItem(k)||"{}");if(!p.theme){p.theme="dark";localStorage.setItem(k,JSON.stringify(p))}}catch(e){}</script>`;
    return c.html((await res.text()).replace('<head>', `<head>${dark}`), 200, { 'Cache-Control': 'no-cache' });
  });

  // ---- The creator's PC (creator_bridge.py), signed with its device key.
  const seen = new Map<string, number>();
  app.use('/bridge/*', async (c, next) => {
    const token = c.req.header('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    const { data } = token ? await db.from('bridge_devices').select('id,user_id').eq('token_hash', sha256(token)).maybeSingle() : { data: null };
    if (!data) return c.json({ error: 'This computer is not connected.' }, 401);
    if ((seen.get(data.id) ?? 0) < Date.now() - 30_000) {
      seen.set(data.id, Date.now());
      await db.from('bridge_devices').update({ last_seen: new Date().toISOString() }).eq('id', data.id);
    }
    c.set('user', data.user_id);
    await next();
  });
  const now = () => new Date().toISOString();
  const fail = (id: string, error: string) => db.from('video_jobs').update({ status: 'failed', error, updated_at: now() }).eq('id', id);
  async function runningBlockout(c: Context<Env>) {
    const { data } = await db.from('video_jobs').select('id,project_id').eq('id', c.req.param('job')!).eq('user_id', c.get('user'))
      .eq('kind', 'blockout').eq('status', 'running').maybeSingle();
    return data;
  }

  app.post('/bridge/claim', async c => {
    const user = c.get('user');
    await c.req.text().catch(() => ''); // an unread body makes the server reset the helper's connection
    // A helper closed mid-build never finishes its job.
    await db.from('video_jobs').update({ status: 'failed', error: 'The Blender helper stopped before finishing. Please try again.', updated_at: now() })
      .eq('user_id', user).eq('kind', 'blockout').eq('status', 'running').lt('updated_at', new Date(Date.now() - 3 * 60 * 60_000).toISOString());
    const { data, error } = await db.rpc('claim_video_job', { p_kinds: ['blockout'], p_user: user });
    if (error) return c.json({ error: 'queue unavailable' }, 503);
    const job = data?.[0];
    if (!job) return c.json(null);
    // Shots come from the project's own breakdown, never from what the browser sent.
    const { data: breakdown } = await db.from('video_jobs').select('output').eq('id', job.input?.breakdown_id ?? '').eq('user_id', user)
      .eq('project_id', job.project_id).eq('kind', 'breakdown').eq('status', 'done').maybeSingle();
    const wanted = new Set(Array.isArray(job.input?.shots) ? job.input.shots.map(Number) : []);
    let board = null;
    try { board = parseStoryboard(breakdown?.output); } catch { /* reported below */ }
    let no = 0;
    const shots: Shot[] = board ? board.scenes.flatMap(scene => scene.shots.map(shot => ({ no: ++no, scene: scene.heading, ...shot }))).filter(s => wanted.has(s.no)) : [];
    if (!board || !shots.length) { await fail(job.id, 'Pick at least one shot from the latest breakdown.'); return c.json(null); }
    return c.json({ id: job.id, spec: { title: board.title, aspect: board.aspect, shots } });
  });

  app.put('/bridge/jobs/:job/files/:name', async c => {
    const job = await runningBlockout(c), name = c.req.param('name');
    if (!job) return c.json({ error: 'This blockout is no longer running.' }, 404);
    if (!SAFE_NAME.test(name) || !BLOCKOUT_FILE.test(name)) return c.json({ error: 'Unexpected file.' }, 400);
    try { await saveBody(c.req.raw, join(projectDir(c.get('user'), job.project_id), 'blockout', job.id, name), 2048 * MB); }
    catch (e) { return c.json({ error: e instanceof UploadError ? e.message : 'Upload failed.' }, 400); }
    return c.json({ ok: true });
  });

  app.post('/bridge/jobs/:job/finish', async c => {
    const job = await runningBlockout(c);
    if (!job) return c.json({ error: 'This blockout is no longer running.' }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (!body.ok) { await fail(job.id, `Blender on your computer: ${String(body.error ?? 'unknown error').slice(-1500)}`); return c.json({ ok: true }); }
    const dir = join(projectDir(c.get('user'), job.project_id), 'blockout', job.id);
    const files = (Array.isArray(body.files) ? body.files : []).filter((f: unknown) => typeof f === 'string' && SAFE_NAME.test(f) && existsSync(join(dir, f)));
    const shots = (Array.isArray(body.shots) ? body.shots : []).map((s: { no?: unknown }) => Number(s?.no)).filter((n: number) => n > 0);
    await db.from('video_jobs').update({ status: 'done', output: { files, shots }, updated_at: now() }).eq('id', job.id);
    return c.json({ ok: true });
  });

  // The site, then the Studio UI's own static files (both use /assets with hashed names).
  app.get('*', async c => {
    const path = c.req.path;
    return await file(SITE, path === '/' ? '/index.html' : path)
      ?? (/^\/(assets|icons)\/|^\/favicon\.svg$/.test(path) ? await file(STUDIO_UI, path) : null)
      ?? (path.startsWith('/assets/') ? c.notFound() : await file(SITE, '/index.html'))
      ?? c.notFound();
  });

  serve({ fetch: app.fetch, port });
  console.log(`app server on :${port}, projects in ${DATA}`);
}

function tokenExpiry(token: string) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000; }
  catch { return 0; }
}
