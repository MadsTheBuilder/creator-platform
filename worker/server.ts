import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SupabaseClient } from '@supabase/supabase-js';
// ponytail: the CLI's own `hyperframes preview` server, deep-imported. The chunk name changes with
// every HyperFrames release, so bump it together with the pinned version (0.8.134).
import { createStudioServer } from 'hyperframes/dist/studioServer-PXNJXHMV.js';
import { parseStoryboard } from '../frontend/src/storyboard/composition.ts';
import { JobError } from './job-error.ts';
import { mountMcp } from './mcp.ts';
import { BLOCKOUT_FILE, DATA, ensureProject, hasRoom, isBlank, latestBreakdown, listMedia, listReferences, listTakes, local, MB, mediaPath, mimeOf, owns as ownsProject, projectDir,
  readBoard, readComposition, readPromptBlockout, readPrompts, refPath, SAFE_NAME, saveBody, sendFile, sha256, touchProject, UploadError, writeBoard, writeComposition } from './project-files.ts';
import { finish as finishTranscription, probe, settings, speech, tickets, whisperJson } from './transcribe.ts';

const SITE = local('../frontend/dist');
const STUDIO_UI = local('./node_modules/hyperframes/dist/studio');
const COOKIE = 'hf_session';
const BRIDGE_KIT = local('../bridge');
type Env = { Variables: { user: string } };
type Shot = Record<string, unknown>;

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

  const owns = (user: string, project: string | undefined) => ownsProject(db, user, project);

  // One HyperFrames Studio server per open project, on the volume at <DATA>/projects/<user>/<id>.
  // ponytail: never evicted (each holds a file watcher); evict idle ones if memory gets tight.
  const studios = new Map<string, Promise<ReturnType<typeof createStudioServer>>>();
  function studioFor(user: string, id: string) {
    let studio = studios.get(id);
    if (!studio) {
      studio = (async () => {
        const dir = await ensureProject(user, id);
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
    try { return new Response(await readFile(full), { headers: { 'Content-Type': mimeOf(full), 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' } }); }
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

  // The creator's own Claude / Codex (OAuth bearer tokens, not the cookie).
  mountMcp(app, db, { supabaseUrl: process.env.SUPABASE_URL!, userFor });

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
    if (!isBlank(await readComposition(dir))) return c.json({ seeded: false });
    const latest = await latestBreakdown(db, c.get('user'), id);
    if (!latest) return c.json({ seeded: false });
    await writeComposition(dir, latest.storyboard);
    return c.json({ seeded: true });
  });

  // Uploads (references and Studio media) up to 1 GB, while the volume keeps hasRoom's margin.
  const MEDIA_LIMIT = 1024 * MB;
  // Reference images and videos per shot.
  const refPathFor = (c: Context<Env>) => refPath(c.get('user'), c.req.param('id')!, Number(c.req.param('shot')), c.req.param('name') ?? '');
  app.get('/api/playground/:id/references', async c => {
    if (!await owns(c.get('user'), c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    return c.json(await listReferences(c.get('user'), c.req.param('id')));
  });
  app.put('/api/playground/:id/references/:shot/:name', async c => {
    if (!await owns(c.get('user'), c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    const path = refPathFor(c);
    if (!path) return c.json({ error: 'Images (JPG, PNG, WebP, GIF) and videos (MP4, MOV, WebM) only, with a plain file name.' }, 400);
    if (!await hasRoom(Number(c.req.header('content-length')) || MEDIA_LIMIT)) return c.json({ error: 'The server is out of space for uploads right now. Please try again later.' }, 507);
    try { await saveBody(c.req.raw, path, MEDIA_LIMIT); }
    catch (e) { return c.json({ error: e instanceof UploadError ? e.message : 'The upload failed. Please try again.' }, 400); }
    return c.json({ ok: true });
  });
  app.delete('/api/playground/:id/references/:shot/:name', async c => {
    const path = await owns(c.get('user'), c.req.param('id')) ? refPathFor(c) : null;
    if (!path) return c.json({ error: 'not found' }, 404);
    await rm(path, { force: true });
    return c.json({ ok: true });
  });
  // Studio track: the recording (then transcribed by a 'transcribe' job), music and sound effects.
  app.get('/api/playground/:id/media', async c => {
    if (!await owns(c.get('user'), c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    return c.json(await listMedia(c.get('user'), c.req.param('id')));
  });
  app.put('/api/playground/:id/media/:name', async c => {
    if (!await owns(c.get('user'), c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    const path = mediaPath(c.get('user'), c.req.param('id'), c.req.param('name'));
    if (!path) return c.json({ error: 'Video (MP4, MOV, WebM) or audio (M4A, MP3, WAV, AAC, OGG) only, with a plain file name.' }, 400);
    if (!await hasRoom(Number(c.req.header('content-length')) || MEDIA_LIMIT)) return c.json({ error: 'The server is out of space for uploads right now. Please try again later.' }, 507);
    try { await saveBody(c.req.raw, path, MEDIA_LIMIT); }
    catch (e) { return c.json({ error: e instanceof UploadError ? e.message : 'The upload failed. Please try again.' }, 400); }
    return c.json({ ok: true });
  });
  app.delete('/api/playground/:id/media/:name', async c => {
    const path = await owns(c.get('user'), c.req.param('id')) ? mediaPath(c.get('user'), c.req.param('id'), c.req.param('name')) : null;
    if (!path) return c.json({ error: 'not found' }, 404);
    await rm(path, { force: true });
    return c.json({ ok: true });
  });
  // Stop waiting for a computer (or a Claude Code run that died). One the server is already finishing runs on.
  app.post('/api/playground/:id/transcribe/cancel', async c => {
    if (!await owns(c.get('user'), c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    await db.from('video_jobs').update({ status: 'failed', error: 'Cancelled.', updated_at: new Date().toISOString() })
      .eq('project_id', c.req.param('id')).eq('user_id', c.get('user')).eq('kind', 'transcribe').in('status', ['queued', 'running']).is('output', null);
    return c.json({ ok: true });
  });
  // Studio track: the beat board the creator's Claude made (snapshot_board), and the creator's notes on it (get_board).
  app.get('/api/playground/:id/board', async c => {
    if (!await owns(c.get('user'), c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    return c.json(await readBoard(c.get('user'), c.req.param('id')));
  });
  app.put('/api/playground/:id/board/notes', async c => {
    const user = c.get('user'), id = c.req.param('id');
    if (!await owns(user, id)) return c.json({ error: 'not found' }, 404);
    const board = await readBoard(user, id);
    const body = await c.req.json().catch(() => null) as { round?: unknown; notes?: unknown; note?: unknown } | null;
    if (!board) return c.json({ error: 'There is no beat board yet.' }, 404);
    if (body?.round !== board.round) return c.json({ error: 'Your Claude made a new board meanwhile. Reload to see it.' }, 409);
    const notes = Array.isArray(body.notes) ? body.notes : [];
    if (notes.length !== board.frames.length || notes.some(n => typeof n !== 'string' || n.length > 2000) || (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 4000)))
      return c.json({ error: 'Notes are up to 2000 characters each, and the overall note up to 4000.' }, 400);
    board.frames.forEach((f, i) => { f.note = (notes[i] as string).trim() || undefined; });
    board.note = (body.note as string | undefined)?.trim() || undefined;
    board.notes_at = new Date().toISOString();
    await writeBoard(user, id, board);
    await touchProject(db, id);
    return c.json(board);
  });
  // Production track: the AI video prompts the creator's Claude saved, and the takes generated from them.
  app.get('/api/playground/:id/ai-video', async c => {
    const user = c.get('user'), id = c.req.param('id');
    if (!await owns(user, id)) return c.json({ error: 'not found' }, 404);
    const [prompts, blockout, takes] = await Promise.all([readPrompts(user, id), readPromptBlockout(user, id), listTakes(user, id)]);
    return c.json({ prompts, blockout, takes });
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
    const { error } = await db.from('bridge_devices').insert({ user_id: c.get('user'), token_hash: sha256(token), name: 'My computer' });
    if (error) return c.json({ error: 'Could not connect a new computer. Please try again.' }, 500);
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
    const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.slice(0, -1);
    const zip = new AdmZip();
    for (const name of ['creator_bridge.py', 'blockout.py', 'transcribe.py', 'start-windows.bat', 'README.txt']) zip.addLocalFile(join(BRIDGE_KIT, name), 'creator-bridge');
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
    // Our skin (frontend/public/studio-theme.css) goes last so it overrides the Studio's tokens.
    const html = (await res.text()).replace('<head>', `<head>${dark}`).replace('</head>', '<link rel="stylesheet" href="/studio-theme.css"></head>');
    return c.html(html, 200, { 'Cache-Control': 'no-cache' });
  });

  // ---- The creator's computer: the helper (creator_bridge.py) signs with its device key; their Claude Code,
  // running bridge/transcribe.py, signs with a key for that one job (from transcribe_recording).
  const seen = new Map<string, number>();
  app.use('/bridge/*', async (c, next) => {
    const token = c.req.header('authorization')?.match(/^Bearer (\S+)$/)?.[1] ?? '';
    const ticket = tickets.get(token);
    if (ticket && ticket.until > Date.now()) {
      if (c.req.path !== `/bridge/jobs/${ticket.job}` && !c.req.path.startsWith(`/bridge/jobs/${ticket.job}/`)) return c.json({ error: 'This key is for one transcription only.' }, 401);
      c.set('user', ticket.user);
      return next();
    }
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
  async function runningJob(c: Context<Env>) {
    const { data } = await db.from('video_jobs').select('id,kind,user_id,project_id,input,output').eq('id', c.req.param('job')!).eq('user_id', c.get('user'))
      .in('kind', ['blockout', 'transcribe']).eq('status', 'running').maybeSingle();
    return data && !data.output?.stage ? data : null; // a transcription the server is already finishing takes no more uploads
  }

  app.post('/bridge/claim', async c => {
    const user = c.get('user');
    // Read the body even if unused: an unread body makes the server reset the helper's connection.
    // Helpers from before transcription send no kinds and only build blockouts.
    const body = await c.req.json().catch(() => null);
    const kinds = ['blockout', 'transcribe'].filter(k => Array.isArray(body?.kinds) ? body.kinds.includes(k) : k === 'blockout');
    // A helper closed mid-job never finishes it.
    await db.from('video_jobs').update({ status: 'failed', error: 'Your computer stopped before finishing. Please try again.', updated_at: now() })
      .eq('user_id', user).in('kind', ['blockout', 'transcribe']).eq('status', 'running').lt('updated_at', new Date(Date.now() - 3 * 60 * 60_000).toISOString());
    const { data, error } = await db.rpc('claim_video_job', { p_kinds: kinds, p_user: user });
    if (error) return c.json({ error: 'queue unavailable' }, 503);
    const job = data?.[0];
    if (!job) return c.json(null);
    if (job.kind === 'transcribe') {
      try { await probe(job); } catch (e) { await fail(job.id, e instanceof JobError ? e.message : 'The recording could not be read.'); return c.json(null); }
      return c.json({ id: job.id, kind: 'transcribe' });
    }
    // Shots come from the project's own breakdown, never from what the browser sent.
    const { data: breakdown } = await db.from('video_jobs').select('output').eq('id', job.input?.breakdown_id ?? '').eq('user_id', user)
      .eq('project_id', job.project_id).eq('kind', 'breakdown').eq('status', 'done').maybeSingle();
    const wanted = new Set(Array.isArray(job.input?.shots) ? job.input.shots.map(Number) : []);
    let board = null;
    try { board = parseStoryboard(breakdown?.output); } catch { /* reported below */ }
    let no = 0;
    const shots: Shot[] = board ? board.scenes.flatMap(scene => scene.shots.map(shot => ({ no: ++no, scene: scene.heading, ...shot }))).filter(s => wanted.has(s.no)) : [];
    if (!board || !shots.length) { await fail(job.id, 'Pick at least one shot from the latest breakdown.'); return c.json(null); }
    return c.json({ id: job.id, kind: 'blockout', spec: { title: board.title, aspect: board.aspect, shots } });
  });

  // A transcription: its language and prompt, then the speech itself.
  app.get('/bridge/jobs/:job', async c => {
    const job = await runningJob(c);
    if (job?.kind !== 'transcribe') return c.json({ error: 'This transcription is no longer running.' }, 404);
    return c.json(await settings(db, job));
  });
  app.get('/bridge/jobs/:job/audio', async c => {
    const job = await runningJob(c);
    if (job?.kind !== 'transcribe') return c.json({ error: 'This transcription is no longer running.' }, 404);
    try { return new Response(speech((await probe(job)).src), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } }); }
    catch (e) { return c.json({ error: e instanceof JobError ? e.message : 'The recording could not be read.' }, 404); }
  });

  app.put('/bridge/jobs/:job/files/:name', async c => {
    const job = await runningJob(c), name = c.req.param('name');
    if (!job) return c.json({ error: 'This job is no longer running.' }, 404);
    const blockout = job.kind === 'blockout';
    if (blockout ? !SAFE_NAME.test(name) || !BLOCKOUT_FILE.test(name) : name !== 'whisper.json') return c.json({ error: 'Unexpected file.' }, 400);
    const path = blockout ? join(projectDir(c.get('user'), job.project_id), 'blockout', job.id, name) : whisperJson(c.get('user'), job.project_id);
    try { await saveBody(c.req.raw, path, blockout ? 2048 * MB : 256 * MB); }
    catch (e) { return c.json({ error: e instanceof UploadError ? e.message : 'Upload failed.' }, 400); }
    return c.json({ ok: true });
  });

  app.post('/bridge/jobs/:job/finish', async c => {
    const job = await runningJob(c);
    if (!job) return c.json({ error: 'This job is no longer running.' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const who = job.kind === 'blockout' ? 'Blender on your computer' : 'Transcription on your computer';
    if (!body.ok) { await fail(job.id, `${who}: ${String(body.error ?? 'unknown error').slice(-1500)}`); return c.json({ ok: true }); }
    if (job.kind === 'transcribe') {
      if (!existsSync(whisperJson(c.get('user'), job.project_id))) return c.json({ error: 'Upload whisper.json first.' }, 400);
      // Answer now: the working copy can take minutes, longer than the computer should wait.
      await db.from('video_jobs').update({ output: { stage: 'converting' }, updated_at: now() }).eq('id', job.id);
      void finishTranscription(job)
        .then(output => db.from('video_jobs').update({ status: 'done', output, updated_at: now() }).eq('id', job.id))
        .catch(e => { console.error(`transcription ${job.id} failed`, e); return fail(job.id, e instanceof JobError ? e.message : 'Something went wrong on our side. Please try again.'); })
        .then(() => touchProject(db, job.project_id));
      return c.json({ ok: true });
    }
    const dir = join(projectDir(c.get('user'), job.project_id), 'blockout', job.id);
    const files = (Array.isArray(body.files) ? body.files : []).filter((f: unknown) => typeof f === 'string' && SAFE_NAME.test(f) && existsSync(join(dir, f)));
    const shots = (Array.isArray(body.shots) ? body.shots : []).map((s: { no?: unknown }) => Number(s?.no)).filter((n: number) => n > 0);
    await db.from('video_jobs').update({ status: 'done', output: { files, shots }, updated_at: now() }).eq('id', job.id);
    return c.json({ ok: true });
  });

  // The transcription script, for the creator's Claude Code to fetch (transcribe_recording says how). No secrets in it.
  app.get('/kit/transcribe.py', async c => await file(BRIDGE_KIT, '/transcribe.py') ?? c.notFound());
  // AI video on the creator's computer with their own Higgsfield API key (prepare_generation says how). No secrets in it.
  app.get('/kit/generate.py', async c => await file(BRIDGE_KIT, '/generate.py') ?? c.notFound());

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
