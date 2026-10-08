// The platform as an MCP server (spec 2026-07-28, stateless Streamable HTTP at /mcp), for the creator's own
// Claude or Codex. The client model does the thinking; these tools read and write exactly what the site reads
// and writes (project-files.ts, parseStoryboard), so the Playground shows the results as they land.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lookup, type LookupAddress } from 'node:dns';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { get as httpsGet } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { Context, Hono } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createMcpHandler, getOAuthProtectedResourceMetadataUrl, McpServer, OAuthError, OAuthErrorCode,
  oauthMetadataResponse, originValidationResponse, requireBearerAuth, type AuthInfo, type OAuthMetadata,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { parseStoryboard, totalSeconds, type Storyboard } from '../frontend/src/storyboard/composition.ts';
import { BREAKDOWN_PROMPTS } from './breakdown.ts';
import { JobError } from './job-error.ts';
import {
  DATA, ensureProject, hasRoom, isBlank, latestBreakdown, listMedia, listReferences, listTakes, local, LOCAL_HOST, MB, mediaPath, owns, projectDir, readComposition,
  readBoard, readPromptBlockout, readPrompts, readTranscript, refPath, saveBody, sendFile, sha256, takePath, touchProject, UploadError, UUID, writeBoard, writeComposition,
} from './project-files.ts';
import { BREAKDOWN_SCHEMA } from './schemas.ts';
import { cardSlots, syncStyle } from './style-files.ts';
import { onTopic, saveIdeas } from './radar.ts';
import { probe, ticketFor } from './transcribe.ts';
import { makeStoryboard, readStoryboard, StoryboardError } from './storyboard.ts';
import { checkBlock, estimateUsd, MODELS, promptBlocks, referencesOf, sendable, shotsFromCuts } from './video-prompts.ts';

// Changes exactly when the tools or playbooks change, so clients can tell a new surface from a restart.
export const VERSION = `1.0.0+${sha256(['mcp.ts', 'schemas.ts', 'project-files.ts', '../frontend/src/storyboard/composition.ts', ...readdirSync(local('./prompts')).map(f => `prompts/${f}`)]
  .map(f => readFileSync(local(`./${f}`), 'utf8')).join('\0')).slice(0, 10)}`;
const HYPERFRAMES = local('./node_modules/hyperframes/bin/hyperframes.mjs');
const HF_DOCS = local('./node_modules/hyperframes/dist/docs');
const prompt = (name: string) => readFile(local(`./prompts/${name}`), 'utf8');
const run = promisify(execFile);
const hyperframes = (args: string[], timeout: number) =>
  run(process.execPath, [HYPERFRAMES, ...args], { timeout, maxBuffer: 16 * MB, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' } });

const INSTRUCTIONS = `Creator Platform: the creator's video projects, each on one of two tracks. Production (footage that is shot or AI-generated):
script -> shot breakdown -> Blender blockout -> storyboard (make_storyboard) -> AI video prompts and takes (get_guide("ai-video"); generated only with the creator's
own Higgsfield account) -> HyperFrames edit. Studio (motion graphics built in code around the creator's own
recording, or around music alone): direction + references -> transcript -> sound -> beat plan (approved) -> beat board
(snapshot_board; the creator's notes via get_board) -> HyperFrames build -> snapshot critique -> edit;
read get_guide("studio") first. A project may use one of the creator's saved styles (get_project says which; read it with get_style). Start with list_projects / get_project (it says the track). Before writing a script, breakdown, composition or blockout, read get_guide for that topic: it is the
platform's own playbook and changes with the site. Everything you save appears live in the creator's Playground. Saves are validated; when one
is refused the message says what to fix. Never invent metrics or results for the creator.
Trends & News (Radar): the server collects a week of videos and headlines; YOU group them into video ideas and the server scores them. Read
get_guide("radar"), then list_radar_runs / get_radar_run, save the ideas with save_radar_ideas and review them with review_radar_idea.
Planner: to outline a planned video (sections and talking points from its sources, in the creator's style), read get_guide("outline"),
then list_plan_items / get_plan_item, and save it with save_outline.`;

const TOPICS = ['breakdown', 'script', 'composition', 'blockout', 'studio', 'ai-video', 'radar', 'outline'] as const;
async function guide(topic: (typeof TOPICS)[number]) {
  const join_ = (parts: string[]) => parts.join('\n\n---\n\n');
  if (topic === 'breakdown') return join_(await Promise.all(['mcp-breakdown.md', ...BREAKDOWN_PROMPTS].map(prompt)));
  if (topic === 'script') return join_([await prompt('script.md'), `# Over MCP
Ask the creator for the idea, platform, target length and tone if they have not said. Write the script, show it to them, and only call
save_script once they are happy: it replaces the project's script. A breakdown is made from the saved script.`]);
  if (topic === 'blockout') return prompt('blockout.md');
  if (topic === 'ai-video') return prompt('ai-video.md');
  if (topic === 'radar') return prompt('radar.md');
  if (topic === 'outline') return prompt('outline.md');
  const docs = await Promise.all(['compositions.md', 'data-attributes.md', 'gsap.md', 'troubleshooting.md'].map(f => readFile(join(HF_DOCS, f), 'utf8').catch(() => '')));
  return join_([...topic === 'studio' ? [await prompt('studio.md')] : [], await prompt('composition.md'), ...docs.filter(Boolean)]);
}

// ---- small per-process guards. ponytail: in memory, fine for the single worker; move to Postgres before scaling out.
const calls = new Map<string, { start: number; count: number }>();
function rateLimited(user: string) {
  const now = Date.now(), hit = calls.get(user);
  if (!hit || now - hit.start > 60_000) { calls.set(user, { start: now, count: 1 }); return false; }
  return ++hit.count > 120;
}
const done = new Map<string, unknown>();
function remember(key: string, result: unknown) {
  done.set(key, result);
  if (done.size > 1000) done.delete(done.keys().next().value!);
  return result;
}
const uploads = new Map<string, { user: string; project: string; path: string; limit: number; until: number }>();
// Short-lived read links for prepare_generation: a project file (a reference for Higgsfield to pull) or the API kit's manifest.
// ponytail: in memory like uploads; a restart drops them and prepare_generation is simply called again.
const downloads = new Map<string, { path?: string; json?: Record<string, unknown>; until: number }>();
function linkFor(origin: string, item: { path?: string; json?: Record<string, unknown> }, ms: number) {
  const token = randomBytes(24).toString('base64url');
  downloads.set(token, { ...item, until: Date.now() + ms });
  for (const [t, d] of downloads) if (d.until < Date.now()) downloads.delete(t);
  return `${origin}/mcp-download/${token}`;
}
// A project file named by its path inside the project (references/shot-3/a.png), or null if it is outside, hidden or missing.
function projectFile(user: string, project: string, path: string) {
  const dir = projectDir(user, project), full = resolve(dir, path);
  if (!full.startsWith(dir + sep) || /(^|[\/])\./.test(path)) return null;
  return statSync(full, { throwIfNoEntry: false })?.isFile() ? full : null;
}

// Reference images over 5 MB go out as a 2048 px JPEG (video models refuse or choke on huge PNGs), cached next to the file.
async function lightImage(path: string) {
  if (statSync(path).size <= 5 * MB) return path;
  const out = join(dirname(path), `.${basename(path)}.send.jpg`);
  if ((statSync(out, { throwIfNoEntry: false })?.mtimeMs ?? 0) < statSync(path).mtimeMs)
    await run('ffmpeg', ['-v', 'error', '-y', '-i', path, '-vf', "scale='min(2048,iw)':-2", '-q:v', '2', out], { timeout: 120_000 });
  return out;
}

// Fetch a public https link (a generated take on the model's CDN) without letting it reach our own network:
// every address the name resolves to is checked at connect time, and each redirect goes through the same check.
const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 127], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');
const isPrivate = (address: string) => PRIVATE.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
function publicLookup(host: string, options: { all?: boolean }, done: (err: Error | null, address?: string | LookupAddress[], family?: number) => void) {
  lookup(host, { ...options, all: true }, (err, list) => {
    if (err) return done(err);
    if (!list.length || list.some(a => isPrivate(a.address))) return done(new UploadError('That link does not point to a public address.'));
    options.all ? done(null, list) : done(null, list[0].address, list[0].family);
  });
}
function getPublic(url: string, hops = 3): Promise<IncomingMessage> {
  return new Promise((resolve_, reject) => {
    let u: URL;
    try { u = new URL(url); } catch { return reject(new UploadError('That is not a link.')); }
    if (u.protocol !== 'https:') return reject(new UploadError('Only https links can be imported.'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && isPrivate(host)) return reject(new UploadError('That link does not point to a public address.'));
    const req = httpsGet(u, { lookup: publicLookup as never, timeout: 30_000 }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return hops ? getPublic(new URL(res.headers.location, u).href, hops - 1).then(resolve_, reject) : reject(new UploadError('The link redirects too many times.'));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new UploadError(`The link answered ${res.statusCode}.`)); }
      resolve_(res);
    });
    req.on('timeout', () => req.destroy(new UploadError('The link stopped responding.')));
    req.on('error', reject);
  });
}

type Result = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
// Both carry everything: Claude Code reads structuredContent on success but only the text on an error,
// so a refusal's reasons (e.g. hyperframes check errors) must be in the text too.
const ok = (data: Record<string, unknown>, message?: string): Result => {
  const structured = message ? { ...data, message } : data;
  return { content: [{ type: 'text', text: message ? `${message}\n\n${JSON.stringify(data, null, 1)}` : JSON.stringify(data, null, 1) }], structuredContent: structured };
};
const refuse = (text: string): Result => ({ content: [{ type: 'text', text }], isError: true });
// The same schema the worker's own Claude call is held to (schemas.ts).
const STORYBOARD = z.fromJSONSchema(BREAKDOWN_SCHEMA as never) as z.ZodType<Omit<Storyboard, 'aspect'>>;
const projectId = z.string().regex(UUID).describe('Project id from list_projects.');
// The same paths creator_style_files allows (migration 20261011090000_creator_styles.sql).
const STYLE_PATH = /^(DESIGN\.md|voice\.md|analysis\.md|style\.json|tokens\.css|notes\.md|cards\/[a-z0-9-]{1,40}\/[a-z0-9-]{1,60}\.html)$/;
const CORE_STYLE_FILES = ['notes.md', 'DESIGN.md', 'style.json', 'tokens.css', 'voice.md'];
const requestId = z.string().max(100).optional().describe('Optional. Repeating a call with the same request_id returns the first result instead of acting twice.');

function summary(sb: Storyboard) {
  return { title: sb.title, aspect: sb.aspect, scenes: sb.scenes.length, shots: sb.scenes.reduce((n, s) => n + s.shots.length, 0), total_seconds: totalSeconds(sb) };
}

// A scratch copy of a project folder with its own index.html: folders and big files are linked, not copied.
async function scratchCopy(dir: string, html: string, only?: string[]) {
  await mkdir(join(DATA, 'tmp'), { recursive: true });
  const scratch = await mkdtemp(join(DATA, 'tmp', 'scratch-'));
  await writeFile(join(scratch, 'index.html'), html);
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name === 'index.html' || entry.name.startsWith('.') || (only && !only.includes(entry.name))) continue;
    const from = join(dir, entry.name), to = join(scratch, entry.name);
    if (entry.isDirectory()) await symlink(from, to, 'junction');
    else if ((await stat(from)).size <= 5 * MB) await copyFile(from, to);
    else await symlink(from, to).catch(() => copyFile(from, to));
  }
  return scratch;
}

// hyperframes check on a scratch copy of the project with the new index.html. Errors block the save.
async function check(dir: string, html: string) {
  const scratch = await scratchCopy(dir, html);
  try {
    const out = await hyperframes(['check', '--json', '--no-contrast', scratch], 120_000)
      .catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }));
    type Finding = { severity: string; code: string; message: string; selector?: string; containerSelector?: string; text?: string; firstSeen?: number; lastSeen?: number; fixHint?: string };
    let report: Record<string, { findings?: Finding[] }> & { ok?: boolean };
    try { report = JSON.parse(out.stdout); } catch { return { ran: false, errors: [], warnings: [] }; }
    // `with` is the other element (the block it overlaps, the container it overflows): without it the fix is a guess.
    const findings = ['lint', 'runtime', 'layout', 'motion'].flatMap(k => report[k]?.findings ?? [])
      .map(f => ({ severity: f.severity, code: f.code, message: f.message, where: f.selector, with: f.containerSelector, text: f.text,
        seconds: f.firstSeen === undefined ? undefined : `${f.firstSeen}-${f.lastSeen}`, fix: f.fixHint }));
    return { ran: true, errors: findings.filter(f => f.severity === 'error'), warnings: findings.filter(f => f.severity === 'warning').slice(0, 20) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

export function createMcp(db: SupabaseClient) {
  return createMcpHandler(({ authInfo }) => {
    const user = String(authInfo?.extra?.user ?? '');
    const server = new McpServer({ name: 'creator-platform', title: 'Creator Platform', version: VERSION }, {
      instructions: INSTRUCTIONS,
      cacheHints: { 'tools/list': { ttlMs: 60_000, cacheScope: 'private' }, 'server/discover': { ttlMs: 60_000, cacheScope: 'private' } },
    });
    const read = { readOnlyHint: true, openWorldHint: false };
    const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

    // Every tool runs as the signed-in creator, rate limited, with its own project checked.
    type Handler<A> = (args: A) => Promise<Result>;
    const guarded = <A extends { project_id?: string; request_id?: string }>(name: string, fn: Handler<A>): Handler<A> => async args => {
      if (!user) return refuse('Not signed in.');
      if (rateLimited(user)) return refuse('Too many calls this minute. Wait a moment and try again.');
      if (args.project_id && !await owns(db, user, args.project_id)) return refuse('No project with that id. Call list_projects.');
      const key = args.request_id && `${user}:${name}:${args.request_id}`;
      if (key && done.has(key)) return done.get(key) as Result;
      try {
        const result = await fn(args);
        return key && !result.isError ? remember(key, result) as Result : result;
      } catch (e) {
        console.error(`mcp ${name} failed`, e);
        return refuse('Something went wrong on our side. Try again in a moment.');
      }
    };

    server.registerTool('get_guide', {
      title: 'Read a playbook',
      description: 'The platform\'s playbook for a step: how to write a script, a shot breakdown, a HyperFrames composition, or fields a Blender blockout understands; "radar" is how to re-evaluate the Trends & News ideas; "outline" is how to outline a planned video. Read it before that step.',
      inputSchema: z.object({ topic: z.enum(TOPICS) }),
      annotations: read,
    }, guarded('get_guide', async ({ topic }) => { const text = await guide(topic); return { content: [{ type: 'text', text }], structuredContent: { topic, guide: text } }; }));

    server.registerTool('list_projects', {
      title: 'List projects',
      description: 'The creator\'s Playground projects, most recently changed first.',
      annotations: read,
    }, guarded('list_projects', async () => {
      const { data, error } = await db.from('projects').select('id,name,track,updated_at').eq('user_id', user).order('updated_at', { ascending: false });
      if (error) throw error;
      return ok({ projects: data });
    }));

    server.registerTool('create_project', {
      title: 'Create a project',
      description: 'A new, empty Playground project. The track is fixed once created: "production" for footage that is shot or AI-generated (planned shot by shot), "studio" for motion graphics built in code around the creator\'s own recording. Ask the creator which if it is not clear.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(80), track: z.enum(['production', 'studio']).default('production'),
        style_id: z.string().regex(UUID).nullable().optional().describe('The creator style to build in (list_styles). Leave out to use the default style; null for none.'),
        request_id: requestId,
      }),
      annotations: write,
    }, guarded('create_project', async ({ name, track, style_id }) => {
      if (style_id === undefined) style_id = (await db.from('creator_styles').select('id').eq('user_id', user).eq('is_default', true).maybeSingle()).data?.id ?? null;
      else if (style_id && !(await db.from('creator_styles').select('id').eq('id', style_id).eq('user_id', user).maybeSingle()).data) return refuse('No style with that id. Call list_styles.');
      const { data, error } = await db.from('projects').insert({ user_id: user, name, track, style_id }).select('id,name,track,style_id,updated_at').single();
      if (error) throw error;
      return ok({ project: data });
    }));

    server.registerTool('get_project', {
      title: 'Get a project',
      description: 'Everything about one project in one call: its track, script (with its hash for save_script), Studio direction and beat plan, the creator style it uses (read it with get_style), latest breakdown summary, Studio composition state, references, recent blockouts, the AI video prompts and takes (Production), and whether the creator\'s Blender helper is online.',
      inputSchema: z.object({ project_id: projectId }),
      annotations: read,
    }, guarded('get_project', async ({ project_id }) => {
      const [{ data: project }, breakdown, html, references, { data: blockouts }, { data: devices }, media, words, { data: transcription }, prompts, takes, promptBlockout, board] = await Promise.all([
        db.from('projects').select('id,name,track,script,direction,beat_plan,style_id,updated_at').eq('id', project_id).single(),
        latestBreakdown(db, user, project_id),
        ensureProject(user, project_id).then(readComposition),
        listReferences(user, project_id),
        db.from('video_jobs').select('id,status,input,error,created_at').eq('project_id', project_id).eq('user_id', user).eq('kind', 'blockout').order('created_at', { ascending: false }).limit(5),
        db.from('bridge_devices').select('last_seen').eq('user_id', user).gt('last_seen', new Date(Date.now() - 90_000).toISOString()),
        listMedia(user, project_id),
        readTranscript(user, project_id),
        db.from('video_jobs').select('id,status,error,input').eq('project_id', project_id).eq('user_id', user).eq('kind', 'transcribe').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        readPrompts(user, project_id),
        listTakes(user, project_id),
        readPromptBlockout(user, project_id),
        readBoard(user, project_id),
      ]);
      const style = project?.style_id ? (await db.from('creator_styles').select('id,name').eq('id', project.style_id).eq('user_id', user).maybeSingle()).data : null;
      return ok({
        project: { ...project, script_hash: sha256(project?.script ?? '') },
        // The creator style to build in (get_style); the project's direction and references outrank it.
        style,
        // Studio track: the recording, music and effects in media/, and the transcript's size.
        ...project?.track === 'studio' && {
          media, transcript: words && { words: words.length, seconds: words.at(-1)?.end ?? 0 },
          transcription: transcription && { job_id: transcription.id, status: transcription.status, error: transcription.error, language: transcription.input?.language, writing: transcription.input?.writing },
          // The beat board the creator annotates before the full build (get_board reads the notes).
          board: board && { round: board.round, frames: board.frames.length, notes: board.frames.filter(f => f.note?.trim()).length + (board.note?.trim() ? 1 : 0), notes_at: board.notes_at ?? null },
        },
        breakdown: breakdown && { id: breakdown.id, source: breakdown.source, created_at: breakdown.created_at, ...summary(breakdown.storyboard) },
        composition: { blank: isBlank(html), hash: sha256(html), bytes: Buffer.byteLength(html) },
        references,
        blockouts: (blockouts ?? []).map(j => ({ job_id: j.id, status: j.status, shots: j.input?.shots, error: j.error, created_at: j.created_at })),
        // Production track: the saved AI video prompts (save_prompts) and the takes generated from them.
        ...project?.track === 'production' && { ai_video: { prompts, blockout: promptBlockout, takes } },
        blender_helper_online: Boolean(devices?.length),
      });
    }));

    server.registerTool('save_script', {
      title: 'Save the script',
      description: 'Replace the project\'s script (what the Script step shows and the breakdown is made from). Pass expected_script_hash from get_project so a script the creator edited meanwhile is not overwritten.',
      inputSchema: z.object({ project_id: projectId, script: z.string().min(1).max(60000), expected_script_hash: z.string().regex(/^[a-f0-9]{64}$/), request_id: requestId }),
      annotations: { ...write, idempotentHint: true },
    }, guarded('save_script', async ({ project_id, script, expected_script_hash }) => {
      const {data,error}=await db.rpc('save_project_script',{p_user:user,p_project:project_id,p_expected_hash:expected_script_hash,p_script:script});
      if(error?.message==='version_conflict')return refuse('The project script changed. Call get_project, then apply your edit to the current script.');
      if(error)throw error;
      return ok({saved:true,script_hash:data.script_hash});
    }));

    server.registerTool('get_breakdown', {
      title: 'Get the shot breakdown',
      description: 'The project\'s latest shot breakdown (the storyboard the Shots step, the animatic and the blockout all use).',
      inputSchema: z.object({ project_id: projectId }),
      annotations: read,
    }, guarded('get_breakdown', async ({ project_id }) => {
      const latest = await latestBreakdown(db, user, project_id);
      if (!latest) return ok({ breakdown: null }, 'No breakdown yet. Read get_guide("breakdown") and make one.');
      return ok({ breakdown_id: latest.id, source: latest.source, total_seconds: totalSeconds(latest.storyboard), storyboard: latest.storyboard });
    }));

    server.registerTool('save_breakdown', {
      title: 'Save a shot breakdown',
      description: 'Save a shot breakdown as the project\'s latest. It appears in the Shots step at once, and seeds the animatic and blockout. Follow get_guide("breakdown"). Every shot needs camera position, angle, lens, lighting, movement and duration.',
      inputSchema: z.object({
        project_id: projectId,
        vision: z.object({
          format: z.string().max(300).describe('Format and tone.'),
          method: z.string().max(300).describe('Production method.'),
          aspect: z.enum(['16:9', '9:16']),
          runtime: z.int().min(1).max(1800).optional().describe('Target runtime in seconds.'),
          feel: z.string().max(1000).describe('How it should feel.'),
        }),
        storyboard: STORYBOARD,
        request_id: requestId,
      }),
      annotations: write,
    }, guarded('save_breakdown', async ({ project_id, vision, storyboard }) => {
      let board: Storyboard;
      try { board = parseStoryboard({ ...storyboard, aspect: vision.aspect }); }
      catch (e) { return refuse(`${(e as Error).message}. Text fields are at most 2000 characters (headings 300, brief 5000, title 200), durations whole seconds 1-120, total at most 30 minutes. Fix it and save again.`); }
      const { data: project } = await db.from('projects').select('script').eq('id', project_id).single();
      const { data, error } = await db.from('video_jobs').insert({
        user_id: user, project_id, kind: 'breakdown', status: 'done', output: board,
        input: { source: 'mcp', vision, script: project?.script ?? '' },
      }).select('id').single();
      if (error) throw error;
      return ok({ breakdown_id: data.id, ...summary(board) }, `Saved: ${summary(board).shots} shots, ${totalSeconds(board)} s. It is in the Shots step now. Next: seed_composition for the animatic, or queue_blockout for a Blender previs.`);
    }));

    server.registerTool('seed_composition', {
      title: 'Build the animatic',
      description: 'Build the HyperFrames animatic from the latest breakdown into the project\'s Studio editor. Only replaces a blank project unless overwrite is true, which discards the creator\'s edits: ask them first.',
      inputSchema: z.object({ project_id: projectId, overwrite: z.boolean().default(false) }),
      annotations: { ...write, destructiveHint: true },
    }, guarded('seed_composition', async ({ project_id, overwrite }) => {
      const dir = await ensureProject(user, project_id);
      if (!overwrite && !isBlank(await readComposition(dir))) return refuse('The Studio project already has edits. Use get_composition / save_composition to change it, or pass overwrite: true if the creator agreed to start over.');
      const latest = await latestBreakdown(db, user, project_id);
      if (!latest) return refuse('There is no breakdown yet. Save one with save_breakdown first.');
      await writeComposition(dir, latest.storyboard);
      await touchProject(db, project_id);
      return ok({ seeded: true, hash: sha256(await readComposition(dir)) }, 'The animatic is in the Studio editor (Playground > Video edit).');
    }));

    server.registerTool('get_composition', {
      title: 'Read the composition',
      description: 'The project\'s HyperFrames index.html as the Studio editor has it, plus its hash for save_composition. Read get_guide("composition") before editing.',
      inputSchema: z.object({ project_id: projectId }),
      annotations: read,
    }, guarded('get_composition', async ({ project_id }) => {
      const dir = await ensureProject(user, project_id);
      await syncStyle(db, user, project_id, dir);
      const html = await readComposition(dir);
      const files = (await readdir(dir, { recursive: true })).map(String).filter(f => !f.startsWith('.') && f !== 'index.html');
      return ok({ hash: sha256(html), blank: isBlank(html), files, html });
    }));

    server.registerTool('save_composition', {
      title: 'Save the composition',
      description: 'Replace the project\'s HyperFrames index.html. Runs hyperframes check first (about 20 s): errors refuse the save and are returned to fix. expected_hash must be the hash from get_composition, so edits the creator made in the Studio are never overwritten.',
      inputSchema: z.object({ project_id: projectId, html: z.string().min(1).max(2 * MB), expected_hash: z.string(), request_id: requestId }),
      annotations: { ...write, idempotentHint: true },
    }, guarded('save_composition', async ({ project_id, html, expected_hash }) => {
      const dir = await ensureProject(user, project_id);
      const current = sha256(await readComposition(dir));
      if (expected_hash !== current) return refuse(`The composition changed since you read it (hash is now ${current}). Call get_composition and apply your change to the current file.`);
      await syncStyle(db, user, project_id, dir);
      const report = await check(dir, html);
      if (report.errors.length) {
        // Block only on errors this edit introduced; ones already in the file (e.g. from Studio edits) are reported, not blocking.
        const before = new Set((await check(dir, await readComposition(dir))).errors.map(e => `${e.code}|${e.where}`));
        const added = report.errors.filter(e => !before.has(`${e.code}|${e.where}`));
        if (added.length) return { ...ok({ saved: false, ...report, errors: added }, `hyperframes check found ${added.length} new error(s); nothing was saved. Fix them and save again.`), isError: true };
        report.warnings.unshift(...report.errors.map(e => ({ ...e, severity: 'existing error' })));
      }
      if (sha256(await readComposition(dir)) !== current) return refuse('The creator edited the composition while it was being checked. Call get_composition and apply your change again.');
      await writeFile(join(dir, '.index.html.part'), html);
      await rename(join(dir, '.index.html.part'), join(dir, 'index.html'));
      await touchProject(db, project_id);
      return ok({ saved: true, hash: sha256(html), checked: report.ran, warnings: report.warnings },
        `Saved; the Studio editor shows it now.${report.ran ? '' : ' (hyperframes check could not run, so it was saved unchecked.)'}${report.warnings.length ? ` ${report.warnings.length} warnings returned.` : ''}`);
    }));

    server.registerTool('list_references', {
      title: 'List references',
      description: 'Reference images and videos the creator attached per shot (used for the 3D step and AI video). shot 0 means project-wide: a Studio project\'s visual references for the whole video. Paths are relative to the composition. Returns the images themselves, and each video as a sheet of 16 frames, so you can see them.',
      inputSchema: z.object({ project_id: projectId }),
      annotations: read,
    }, guarded('list_references', async ({ project_id }) => {
      const references = (await listReferences(user, project_id)).map(r => ({ ...r, path: `references/shot-${r.shot}/${r.name}` }));
      // Show the model what they look like: images as light JPEGs, videos as a 4x4 sheet of evenly spaced frames
      // (cached next to the video as .<name>.sheet.jpg). Shot 0 (the whole video's look) first; files ffmpeg can't read are skipped.
      const dir = projectDir(user, project_id);
      await mkdir(join(DATA, 'tmp'), { recursive: true });
      const tmp = await mkdtemp(join(DATA, 'tmp', 'refs-'));
      const images: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
      try {
        for (const r of [...references].sort((a, b) => a.shot - b.shot).slice(0, 8)) {
          const src = join(dir, r.path);
          const video = /\.(mp4|mov|webm)$/i.test(r.name);
          const jpg = video ? join(dir, 'references', `shot-${r.shot}`, `.${r.name}.sheet.jpg`) : join(tmp, `${images.length}.jpg`);
          try {
            if (video && ((await stat(jpg).catch(() => null))?.mtimeMs ?? 0) < (await stat(src)).mtimeMs) {
              const seconds = Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src])).stdout) || 1;
              await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `fps=${16 / seconds},scale=480:-2,tile=4x4`, '-frames:v', '1', '-q:v', '4', jpg], { timeout: 120_000 });
            } else if (!video) await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', 'scale=960:-2', '-frames:v', '1', '-q:v', '4', jpg]);
            images.push({ type: 'text', text: `${r.path}${video ? ' (16 frames, evenly spaced, left to right, top to bottom):' : ':'}` },
              { type: 'image', data: (await readFile(jpg)).toString('base64'), mimeType: 'image/jpeg' });
          } catch { /* not a readable image or video */ }
        }
      } finally { await rm(tmp, { recursive: true, force: true }); }
      if (!images.length) return ok({ references });
      // No structuredContent: clients that prefer it would drop the images.
      return { content: [{ type: 'text', text: JSON.stringify({ references }, null, 1) }, ...images] } as Result;
    }));

    server.registerTool('create_upload_url', {
      title: 'Get an upload link',
      description: 'A single-use link (10 minutes) to upload one file: PUT the file bytes to it, e.g. curl -T file.jpg "<url>". target "reference" (default): an image or video for a shot (JPG, PNG, WebP, GIF, MP4, MOV, WebM up to 1 GB). target "media" (Studio track): a recording, voiceover, music or sound effect into media/ (MP4, MOV, WebM, M4A, MP3, WAV, AAC, OGG up to 1 GB); after uploading a recording, call transcribe_recording, which runs on the creator\'s computer. target "take" (Production): a generated AI video into takes/ (MP4, MOV, WebM).',
      inputSchema: z.object({
        project_id: projectId, target: z.enum(['reference', 'media', 'take']).default('reference'),
        shot: z.int().min(1).max(999).optional().describe('Shot number, for target "reference".'),
        name: z.string().max(120).describe('File name with extension, e.g. hero-angle.jpg or whoosh.wav'),
      }),
      annotations: write,
    }, guarded('create_upload_url', async ({ project_id, target, shot, name }) => {
      const media = target === 'media', take = target === 'take';
      if (target === 'reference' && !shot) return refuse('Pass the shot number for a reference.');
      const path = media ? mediaPath(user, project_id, name) : take ? takePath(user, project_id, name) : refPath(user, project_id, shot!, name);
      if (!path) return refuse(`Use a plain file name (letters, digits, spaces, . ( ) -) ending in ${media ? '.mp4, .mov, .webm, .m4a, .mp3, .wav, .aac or .ogg' : take ? '.mp4, .mov or .webm' : '.jpg, .jpeg, .png, .webp, .gif, .mp4, .mov or .webm'}.`);
      const token = randomBytes(24).toString('base64url');
      uploads.set(token, { user, project: project_id, path, limit: 1024 * MB, until: Date.now() + 10 * 60_000 });
      const origin = String(authInfo?.extra?.origin ?? '');
      return ok({ url: `${origin}/mcp-upload/${token}`, method: 'PUT', path: media ? `media/${name}` : take ? `takes/${name}` : `references/shot-${shot}/${name}`, expires_in_seconds: 600 });
    }));

    server.registerTool('queue_blockout', {
      title: 'Queue a Blender blockout',
      description: 'Ask the creator\'s Blender helper to build a 3D blockout of these shots from the latest breakdown. Read get_guide("blockout") first. Then poll get_job, and look at the result with get_blockout.',
      inputSchema: z.object({ project_id: projectId, shots: z.array(z.int().min(1).max(999)).min(1).max(200).describe('Shot numbers, counted from 1 across the whole film.'), request_id: requestId }),
      annotations: write,
    }, guarded('queue_blockout', async ({ project_id, shots }) => {
      const latest = await latestBreakdown(db, user, project_id);
      if (!latest) return refuse('There is no breakdown yet. Save one with save_breakdown first.');
      const count = summary(latest.storyboard).shots, wanted = [...new Set(shots)].sort((a, b) => a - b);
      if (wanted.some(n => n > count)) return refuse(`The breakdown has ${count} shots; pick numbers from 1 to ${count}.`);
      const [{ data, error }, { data: devices }] = await Promise.all([
        db.from('video_jobs').insert({ user_id: user, project_id, kind: 'blockout', input: { breakdown_id: latest.id, shots: wanted,
          ...LOCAL_HOST.test(new URL(String(authInfo?.extra?.origin ?? 'http://x')).host) && { local: true } } }).select('id').single(),
        db.from('bridge_devices').select('id').eq('user_id', user).gt('last_seen', new Date(Date.now() - 90_000).toISOString()),
      ]);
      if (error) throw error;
      return ok({ job_id: data.id, status: 'queued', shots: wanted, blender_helper_online: Boolean(devices?.length) },
        devices?.length ? `Queued. Poll get_job("${data.id}") every 20-30 s.` : `Queued, but no Blender helper is online. Ask the creator to start it (Playground > 3D visual > Connect Blender). It will pick the job up when it starts.`);
    }));

    server.registerTool('get_job', {
      title: 'Check a job',
      description: 'Status of a script, breakdown or blockout job: queued, running, done or failed (with the reason).',
      inputSchema: z.object({ job_id: z.string().regex(UUID) }),
      annotations: read,
    }, guarded('get_job', async ({ job_id }) => {
      const { data } = await db.from('video_jobs').select('id,kind,status,error,output,project_id,created_at,updated_at').eq('id', job_id).eq('user_id', user).maybeSingle();
      if (!data) return refuse('No job with that id.');
      const output = data.kind === 'breakdown' && data.output ? { summary: (() => { try { return summary(parseStoryboard(data.output)); } catch { return null; } })() } : data.output;
      return ok({ ...data, output });
    }));

    server.registerTool('get_blockout', {
      title: 'See a blockout',
      description: 'A finished Blender blockout: one still per shot as an image, so you can check each framing against the breakdown, plus its files. Defaults to the latest finished blockout.',
      inputSchema: z.object({ project_id: projectId, job_id: z.string().regex(UUID).optional() }),
      annotations: read,
    }, guarded('get_blockout', async ({ project_id, job_id }) => {
      let query = db.from('video_jobs').select('id,input,output,updated_at').eq('project_id', project_id).eq('user_id', user).eq('kind', 'blockout').eq('status', 'done');
      if (job_id) query = query.eq('id', job_id);
      const { data: job } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!job) return refuse(job_id ? 'That blockout is not finished (check get_job).' : 'No finished blockout yet.');
      const dir = join(projectDir(user, project_id), 'blockout', job.id);
      const files: string[] = (job.output?.files ?? []).filter((f: unknown) => typeof f === 'string');
      const content: Result['content'] | { type: 'image'; data: string; mimeType: string }[] = [];
      const stills = files.filter(f => /^shot-\d+\.png$/.test(f)).slice(0, 12);
      for (const name of stills) {
        const bytes = await readFile(join(dir, name)).catch(() => null);
        if (!bytes || bytes.length > 3 * MB) continue;
        content.push({ type: 'text', text: name.replace(/^shot-0*(\d+)\.png$/, 'Shot $1:') }, { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' });
      }
      const data = { job_id: job.id, shots: job.input?.shots, files, preview: files.includes('preview.mp4') ? `/api/playground/${project_id}/file/blockout/${job.id}/preview.mp4` : null };
      // No structuredContent here: clients that prefer it would drop the stills.
      return { content: [{ type: 'text', text: JSON.stringify(data) }, ...content] } as Result;
    }));

    server.registerTool('make_storyboard', {
      title: 'Make the storyboard',
      description: 'Lay the project\'s storyboard out from a blockout video: 3 frames per shot (6 for shots of 9 s or more) at its start, middle and end, shown in Playground > Storyboard with each shot\'s camera, action, notes and audio from the breakdown. The video must run as long as the shots it covers. It replaces the previous storyboard. Then look at it with get_storyboard.',
      inputSchema: z.object({
        project_id: projectId,
        video: z.string().max(200).describe('blockout/<job_id>/preview.mp4 (a finished blockout; get_project lists them) or references/shot-N/<video> cut to the whole breakdown.'),
        request_id: requestId,
      }),
      annotations: { ...write, idempotentHint: true },
    }, guarded('make_storyboard', async ({ project_id, video }) => {
      try {
        const board = await makeStoryboard(db, user, project_id, video);
        return ok({ shots: board.shots.length, frames: board.shots.reduce((n, s) => n + s.frames.length, 0), seconds: board.seconds },
          'Made; the creator sees it in Playground > Storyboard. Look at it with get_storyboard.');
      } catch (e) { if (e instanceof StoryboardError) return refuse(e.message); throw e; }
    }));

    server.registerTool('get_storyboard', {
      title: 'See the storyboard',
      description: 'The project\'s storyboard: when each frame was taken, plus an overview image of every shot\'s middle frame (five across, in shot order), so you can check each framing against its shot in get_breakdown.',
      inputSchema: z.object({ project_id: projectId }),
      annotations: read,
    }, guarded('get_storyboard', async ({ project_id }) => {
      const board = await readStoryboard(user, project_id);
      if (!board) return refuse('No storyboard yet. Make one from a finished blockout with make_storyboard.');
      const overview = await readFile(join(projectDir(user, project_id), 'storyboard', 'overview.jpg')).catch(() => null);
      // No structuredContent: clients that prefer it would drop the image.
      return { content: [{ type: 'text', text: JSON.stringify(board) }, ...overview ? [{ type: 'image', data: overview.toString('base64'), mimeType: 'image/jpeg' }] : []] } as Result;
    }));

    // ---- Production track, after the 3D visual: AI video prompts, generated with the creator's own Higgsfield account.
    const promptModel = z.enum(Object.keys(MODELS) as [string, ...string[]]).describe('The video model the prompts are written for.');
    const imageIn = (project_id: string) => (path: string) => /\.(png|jpe?g|webp|gif)$/i.test(path) && !!projectFile(user, project_id, path);
    const videoIn = (project_id: string, path: string) => /^(blockout|takes|references)\//.test(path) && /\.(mp4|mov|webm)$/i.test(path) ? projectFile(user, project_id, path) : null;
    const videoPath = z.string().max(200).describe('blockout/<job_id>/preview.mp4, takes/<name>, or references/shot-N/<video>');

    server.registerTool('analyze_video', {
      title: 'Read a video\'s cuts',
      description: 'Cut a blockout preview (blockout/<job_id>/preview.mp4) or a generated take (takes/<name>) into shots by scene detection, and return the shot table plus contact sheets as images (2 frames a second, 15 s per sheet, left to right, top to bottom), so you can read its timing and camera moves. Read get_guide("ai-video") first.',
      inputSchema: z.object({
        project_id: projectId,
        path: videoPath,
        threshold: z.number().min(0.05).max(0.6).default(0.25).describe('Scene-change threshold: lower finds more cuts.'),
      }),
      annotations: read,
    }, guarded('analyze_video', async ({ project_id, path, threshold }) => {
      const src = videoIn(project_id, path);
      if (!src) return refuse(`There is no video at ${path}. Use blockout/<job_id>/preview.mp4 (get_project lists blockouts), takes/<name> or references/shot-N/<name>.`);
      const seconds = Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).catch(() => ({ stdout: '' }))).stdout);
      if (!(seconds > 0)) return refuse('That file is not a readable video.');
      const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', src, '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], { timeout: 300_000, maxBuffer: 64 * MB });
      const shots = shotsFromCuts([...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1])), seconds);
      await mkdir(join(DATA, 'tmp'), { recursive: true });
      const tmp = await mkdtemp(join(DATA, 'tmp', 'cuts-'));
      const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
      try {
        for (let start = 0; start < seconds && start < 120; start += 15) {
          const jpg = join(tmp, `${start}.jpg`);
          await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', '15', '-i', src, '-vf', 'fps=2,scale=320:-2,format=rgb24,tile=6x5:padding=4', '-frames:v', '1', '-q:v', '4', jpg], { timeout: 120_000 });
          content.push({ type: 'text', text: `Sheet ${start}-${Math.min(start + 15, seconds).toFixed(1)}s (frame k at ${start} + 0.5*(k-1) s):` }, { type: 'image', data: (await readFile(jpg)).toString('base64'), mimeType: 'image/jpeg' });
        }
      } finally { await rm(tmp, { recursive: true, force: true }); }
      const table = shots.map(s => `shot ${s.shot}: ${s.start.toFixed(2)} to ${s.end.toFixed(2)}s (${s.duration.toFixed(2)}s)`).join('\n');
      // No structuredContent: clients that prefer it would drop the sheets.
      return { content: [{ type: 'text', text: `${path}: ${seconds.toFixed(2)}s, ${shots.length} shots${seconds > 120 ? ' (sheets cover the first 120 s)' : ''}.\n${table}\n${JSON.stringify({ shots })}` }, ...content] } as Result;
    }));

    server.registerTool('save_prompts', {
      title: 'Save the AI video prompts',
      description: 'Save the project\'s AI video prompts as one markdown document: Director\'s calls and Post lists at the top, then each prompt as a ``` block under a ## heading (## The whole film, ## Segment 1...). Every block holding [GOAL] is checked for the model first: sections in order, the duration limit, contiguous stages with CUT marks, reference images that exist in the project each with a "Do not", Seedance\'s reserved brackets. Problems refuse the save and are returned to fix. It replaces the saved prompts and shows in Playground > AI video, where each take is played against the blockout named here. Read get_guide("ai-video") first.',
      inputSchema: z.object({ project_id: projectId, model: promptModel, markdown: z.string().min(1).max(200_000), blockout: videoPath.describe('The blockout video these prompts follow (the path you gave analyze_video).'), request_id: requestId }),
      annotations: { ...write, idempotentHint: true },
    }, guarded('save_prompts', async ({ project_id, model, markdown, blockout }) => {
      if (!videoIn(project_id, blockout)) return refuse(`There is no video at ${blockout}. Name the blockout the prompts follow, e.g. blockout/<job_id>/preview.mp4.`);
      const blocks = promptBlocks(markdown);
      if (!blocks.length) return refuse('No prompt found: put each prompt in a ``` block containing [GOAL], under a ## heading.');
      const problems = Object.fromEntries(blocks.map(b => [b.heading, checkBlock(b.body, model, imageIn(project_id))] as const).filter(([, errs]) => errs.length));
      if (Object.keys(problems).length) return { ...ok({ saved: false, problems }, 'The prompts have problems; nothing was saved. Fix exactly these and save again.'), isError: true };
      const dir = join(await ensureProject(user, project_id), 'ai-video');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'prompts.md.part'), markdown);
      await rename(join(dir, 'prompts.md.part'), join(dir, 'prompts.md'));
      await writeFile(join(dir, 'source.json'), JSON.stringify({ blockout, model }));
      await touchProject(db, project_id);
      return ok({ saved: true, model, blocks: blocks.map(b => b.heading) }, 'Saved; the creator sees it in Playground > AI video. Generate only when they ask: prepare_generation.');
    }));

    server.registerTool('prepare_generation', {
      title: 'Prepare a generation',
      description: 'Everything needed to generate one saved prompt block with the creator\'s own Higgsfield account: the exact prompt text to send, the reference images in @Image order with download links, duration, aspect ratio, resolution, an upload link for the take (links last 2 hours), and a cost estimate for Seedance. Nothing is generated or paid by this call. route "mcp": you generate with the creator\'s Higgsfield MCP connector, then import_take. route "api": returns commands that run the platform\'s kit on the creator\'s computer with their own Higgsfield API key (Seedance 2.5 only). Get the creator\'s yes on the cost before generating.',
      inputSchema: z.object({
        project_id: projectId,
        block: z.string().max(200).describe('The ## heading of a saved block, e.g. "The whole film" or "Segment 1".'),
        model: promptModel,
        resolution: z.enum(['480p', '720p']).default('480p').describe('Start at 480p; 720p once a take holds.'),
        route: z.enum(['mcp', 'api']).describe('"mcp": the creator\'s Higgsfield connector is in this chat. "api": the creator has a Higgsfield API key and you have a shell on their computer.'),
      }),
      annotations: read,
    }, guarded('prepare_generation', async ({ project_id, block, model, resolution, route }) => {
      const markdown = await readPrompts(user, project_id);
      if (!markdown) return refuse('No prompts saved yet. Write them (get_guide("ai-video")) and save them with save_prompts first.');
      const blocks = promptBlocks(markdown), found = blocks.find(b => b.heading === block);
      if (!found) return refuse(`There is no block "${block}". Saved blocks: ${blocks.map(b => b.heading).join(', ')}.`);
      const errs = checkBlock(found.body, model, imageIn(project_id));
      if (errs.length) return refuse(`That block does not pass the checks for ${model}:\n- ${errs.join('\n- ')}\nFix it with save_prompts first.`);
      const spec = MODELS[model];
      if (route === 'api' && !spec.higgsfield) return refuse(`The API kit generates Seedance 2.5 only. For ${model}, use route "mcp" with the creator's Higgsfield connector, or let the creator paste the prompt from Playground > AI video.`);
      const origin = String(authInfo?.extra?.origin ?? ''), hours2 = 2 * 60 * 60_000;
      const aspect = (await latestBreakdown(db, user, project_id))?.storyboard.aspect ?? '16:9';
      const duration = Number(found.body.match(/^Duration:\s*([\d.]+)/m)![1]);
      const images = await Promise.all(referencesOf(found.body, model).map(async r => ({
        ...spec.tags && { tag: `@Image${r.n}` }, file: r.path, url: linkFor(origin, { path: await lightImage(projectFile(user, project_id, r.path)!) }, hours2),
      })));
      const take = `${block.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'take'}-${resolution}-${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}.mp4`;
      const token = randomBytes(24).toString('base64url');
      uploads.set(token, { user, project: project_id, path: takePath(user, project_id, take)!, limit: 1024 * MB, until: Date.now() + hours2 });
      const estimate = model.startsWith('seedance') ? estimateUsd(duration, resolution, aspect) : null;
      const job = {
        block, model, prompt: sendable(found.body, model), images, duration, aspect_ratio: aspect, resolution,
        take: `takes/${take}`, upload_url: `${origin}/mcp-upload/${token}`,
        ...estimate !== null && { estimate_usd: estimate, estimate_note: 'Higgsfield\'s API price for Seedance, from its published formula. Credits on the Higgsfield connector are priced by Higgsfield.' },
      };
      if (route === 'mcp') return ok(job, `Check the cost with the creator's Higgsfield connector and get their yes first. Then bring each image in from its url${spec.tags ? ', in this order (position N is @ImageN)' : ''}, generate with the prompt, duration, aspect_ratio and resolution below, and call import_take with the finished video's URL (or PUT the file to upload_url).`);
      const manifest = linkFor(origin, { json: { ...job, higgsfield_model: spec.higgsfield } }, hours2);
      return ok({ ...job, manifest_url: manifest }, `With the creator's yes on about $${estimate} (Higgsfield API price), run on their computer, in the background (a take takes minutes). Their own Higgsfield API key must be in the environment as HF_KEY=KEY_ID:KEY_SECRET; never ask them to paste it into this chat.
  pip install higgsfield-client
  curl -fsSL -o generate.py "${origin}/kit/generate.py"
  python generate.py "${manifest}" --budget=${estimate}
It uploads the references to their Higgsfield account, waits for the video and puts it in the project as takes/${take}. The links work for 2 hours. Then analyze_video on takes/${take} and compare it with the blockout.`);
    }));

    server.registerTool('import_take', {
      title: 'Bring a generated take in',
      description: 'Copy a finished AI video from its https link (e.g. the video URL the creator\'s Higgsfield connector returned) into the project\'s takes/, where Playground > AI video and the editor show it. Then compare it with the blockout: analyze_video on takes/<name>.',
      inputSchema: z.object({
        project_id: projectId, url: z.string().max(4000).describe('The video\'s https link.'),
        name: z.string().max(120).describe('File name for the take, e.g. segment-1-480p.mp4 (prepare_generation suggests one).'),
        request_id: requestId,
      }),
      annotations: { ...write, openWorldHint: true },
    }, guarded('import_take', async ({ project_id, url, name }) => {
      const path = takePath(user, project_id, name);
      if (!path) return refuse('Use a plain file name (letters, digits, spaces, . ( ) -) ending in .mp4, .mov or .webm.');
      if (existsSync(path)) return refuse(`takes/${name} already exists. Pick another name.`);
      if (!await hasRoom(1024 * MB)) return refuse('The server is out of space for takes right now. Try again later.');
      try { await saveBody(await getPublic(url), path, 1024 * MB); }
      catch (e) { return refuse(e instanceof UploadError ? e.message : 'The video could not be downloaded from that link. Is it still valid?'); }
      const kind = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path]).catch(() => ({ stdout: '' }))).stdout.trim();
      if (kind !== 'video') { await rm(path, { force: true }); return refuse('That link is not a video.'); }
      await touchProject(db, project_id);
      return ok({ saved: true, take: `takes/${name}` }, `Saved; it shows in Playground > AI video and the editor's Assets. Compare it with the blockout: analyze_video on takes/${name}.`);
    }));

    // ---- Studio track: the recording's words, the beat plan, the music's beats, and eyes on the build.
    server.registerTool('get_transcript', {
      title: 'Read the transcript',
      description: 'Every word of the Studio project\'s recording with its start and end in seconds, one per line ("start end word"). Cuts, reveals and captions are timed to these. Read get_guide("studio") first.',
      inputSchema: z.object({ project_id: projectId }),
      annotations: read,
    }, guarded('get_transcript', async ({ project_id }) => {
      const words = await readTranscript(user, project_id);
      if (!words?.length) return refuse('There is no transcript yet. Ask the creator to upload their recording in Playground > Direct, or upload it with create_upload_url (target "media") and call transcribe_recording.');
      const lines = words.map(w => `${w.start.toFixed(2)} ${w.end.toFixed(2)} ${w.text}`).join('\n');
      const devanagari = words.filter(w => /[ऀ-ॿ]/.test(w.text)).length;
      let note: string | undefined;
      if (devanagari) {
        const { data: job } = await db.from('video_jobs').select('input').eq('project_id', project_id).eq('user_id', user).eq('kind', 'transcribe').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (job?.input?.writing === 'roman') note = `${devanagari} words are in Devanagari but the creator chose Roman letters: convert every Devanagari word to Roman Hinglish with fix_transcript (timings are kept), matching the script's spelling when there is one, before you time anything to the words.`;
      }
      return ok({ words: words.length, seconds: words.at(-1)!.end, devanagari, ...note && { note }, transcript: lines },
        `${words.length} words, ${words.at(-1)!.end.toFixed(1)} s. One word per line: start end word.${note ? `\nNOTE: ${note}` : ''}\n${lines}`);
    }));

    server.registerTool('transcribe_recording', {
      title: 'Transcribe a recording',
      description: 'Make a recording in media/ the Studio project\'s recording. Speech to text runs on the creator\'s own computer, never on the server; the server then makes the 1080p working copy (media/recording.mp4, or .m4a for audio only). on "here" (default, for clients with a shell on the creator\'s computer, like Claude Code): returns two commands to run there; the first run downloads whisper.cpp and its speech model (~1.6 GB). on "helper": queues it for the creator\'s paired helper app instead (Playground > Direct), for clients without a shell. The project\'s script, if it has one, guides the spelling. Then poll get_job and call get_transcript.',
      inputSchema: z.object({
        project_id: projectId, file: z.string().max(120).describe('File name in media/, e.g. take-2.mp4'),
        language: z.enum(['hi', 'en']).default('hi').describe('"hi" for Hindi or Hinglish, "en" for English. Ask the creator if unsure.'),
        writing: z.enum(['roman', 'devanagari']).default('roman').describe('For Hindi: write it in Roman letters (Hinglish, the default) or Devanagari. Ignored when the project has a script, whose writing wins.'),
        on: z.enum(['here', 'helper']).default('here').describe('"here": you run it on this computer. "helper": the creator\'s helper app runs it.'),
        request_id: requestId,
      }),
      annotations: write,
    }, guarded('transcribe_recording', async ({ project_id, file, language, writing, on }) => {
      const path = mediaPath(user, project_id, file);
      if (!path || !(await stat(path).catch(() => null))?.isFile()) return refuse(`There is no media/${file}. Upload it first with create_upload_url (target "media"). Files over 1 GB: make a 1080p copy first (ffmpeg -i in.mov -vf scale=-2:1080 -c:v libx264 -crf 20 -c:a aac out.mp4).`);
      try { await probe({ id: '', user_id: user, project_id, input: { file } }); }
      catch (e) { if (e instanceof JobError) return refuse(e.message); throw e; }
      // One transcription per project at a time: a new one replaces any still waiting or running.
      await db.from('video_jobs').update({ status: 'failed', error: 'Replaced by a newer transcription.', updated_at: new Date().toISOString() })
        .eq('project_id', project_id).eq('user_id', user).eq('kind', 'transcribe').in('status', ['queued', 'running']);
      const helper = on === 'helper';
      const { data, error } = await db.from('video_jobs').insert({ user_id: user, project_id, kind: 'transcribe', status: helper ? 'queued' : 'running',
        input: { file, language, writing, on: helper ? 'helper' : 'claude' } }).select('id').single();
      if (error) throw error;
      if (helper) {
        const { data: devices } = await db.from('bridge_devices').select('last_seen').eq('user_id', user).gt('last_seen', new Date(Date.now() - 90_000).toISOString());
        return ok({ job_id: data.id, status: 'queued', helper_online: Boolean(devices?.length) }, `Queued for the creator's helper app${devices?.length ? ', which is online' : '. It is offline: ask the creator to start it (or download it from Playground > Direct)'}. Poll get_job("${data.id}") every 30 s, then call get_transcript.`);
      }
      const origin = String(authInfo?.extra?.origin ?? ''), job = `${origin}/bridge/jobs/${data.id}`, key = ticketFor(user, data.id);
      return ok({ job_id: data.id, status: 'running', script_url: `${origin}/kit/transcribe.py`, job_url: job, key },
        `Run these on the creator's computer (Python 3, nothing else to install; use python3 if python is missing):
  curl -fsSL -o transcribe.py "${origin}/kit/transcribe.py"
  python transcribe.py "${job}" "${key}"
The first run downloads whisper.cpp and the speech model (~1.6 GB) into a cache, so run it in the background and watch its output. On a Mac without Homebrew's whisper-cpp it says what to install. Speech takes about a minute per minute on a laptop; then the server makes the working copy. Poll get_job("${data.id}") until done, then call get_transcript. The key works for this one job for 6 hours.`);
    }));

    server.registerTool('fix_transcript', {
      title: 'Correct transcript words',
      description: 'Correct misheard words in the transcript, keeping their timings: each edit replaces the text of the word at that index (0-based, the line number in get_transcript minus one). Compare against the creator\'s script to fix names and spelling before timing captions to it. Also converts Devanagari words to Roman letters (Hinglish), timings kept.',
      inputSchema: z.object({
        project_id: projectId,
        edits: z.array(z.object({ index: z.int().min(0), text: z.string().trim().min(1).max(60) })).min(1).max(5000),
        request_id: requestId,
      }),
      annotations: { ...write, idempotentHint: true },
    }, guarded('fix_transcript', async ({ project_id, edits }) => {
      const words = await readTranscript(user, project_id);
      if (!words?.length) return refuse('There is no transcript yet.');
      const bad = edits.find(e => e.index >= words.length);
      if (bad) return refuse(`The transcript has ${words.length} words (indexes 0-${words.length - 1}); ${bad.index} is out of range.`);
      for (const e of edits) words[e.index] = { ...words[e.index], text: e.text };
      const file = join(projectDir(user, project_id), 'transcript.json');
      await writeFile(`${file}.part`, JSON.stringify(words, null, 2));
      await rename(`${file}.part`, file);
      await touchProject(db, project_id);
      return ok({ saved: true, changed: edits.length }, `Corrected ${edits.length} word(s); timings unchanged.`);
    }));

    server.registerTool('save_plan', {
      title: 'Save the beat plan',
      description: 'Save the Studio project\'s beat plan (the brief, then one line per beat: time, words, picture, sound). It shows on the Direct step. Then ask the creator to approve it before you build.',
      inputSchema: z.object({ project_id: projectId, plan: z.string().trim().min(1).max(20000), request_id: requestId }),
      annotations: { ...write, idempotentHint: true },
    }, guarded('save_plan', async ({ project_id, plan }) => {
      const { error } = await db.from('projects').update({ beat_plan: plan, updated_at: new Date().toISOString() }).eq('id', project_id).eq('user_id', user);
      if (error) throw error;
      await writeFile(join(await ensureProject(user, project_id), 'BRIEF.md'), plan);
      return ok({ saved: true }, 'Saved; it shows in Playground > Direct (and as BRIEF.md in the project folder). Ask the creator to approve or change it before building.');
    }));

    server.registerTool('analyze_beats', {
      title: 'Find the music\'s beats',
      description: 'Detect the beats of a music file in media/ (about 5 s). Returns the tempo and every beat time; strong beats are the best cut points. Also saved as beats/media/<file>.json in the project.',
      inputSchema: z.object({ project_id: projectId, file: z.string().max(120).describe('Music file name in media/, e.g. track.mp3') }),
      annotations: read,
    }, guarded('analyze_beats', async ({ project_id, file }) => {
      const path = mediaPath(user, project_id, file), size = path && (await stat(path).catch(() => null))?.size;
      if (!size) return refuse(`There is no media/${file}.`);
      if (size > 80 * MB) return refuse('Music files up to 80 MB can be analysed.');
      const dir = projectDir(user, project_id);
      // `hyperframes beats` reads the composition's music track, so give it a composition holding only this file.
      const scratch = await scratchCopy(dir, `<!doctype html><html><body><div id="root" data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080"><audio id="music" data-timeline-role="music" src="media/${file}" data-start="0" data-duration="10"></audio></div></body></html>`, ['media']);
      try {
        const out = await hyperframes(['beats', '--json', scratch], 120_000).catch((e: { stderr?: string }) => { throw new Error(e.stderr ?? 'beats failed'); });
        const result = JSON.parse(out.stdout) as { bpm?: number };
        const json = await readFile(join(scratch, 'beats', 'media', `${file}.json`), 'utf8');
        await mkdir(join(dir, 'beats', 'media'), { recursive: true });
        await writeFile(join(dir, 'beats', 'media', `${file}.json`), json);
        const beats: { time: number; strength: number }[] = JSON.parse(json).beats;
        return ok({ file: `media/${file}`, bpm: result.bpm ?? null, count: beats.length, beats: beats.map(b => b.time), strong: beats.filter(b => b.strength >= 0.8).map(b => b.time) });
      } catch (e) {
        console.error('analyze_beats', e);
        return refuse('No beats were found in that file. Is it music with a beat (not silence or ambience)?');
      } finally { await rm(scratch, { recursive: true, force: true }); }
    }));

    server.registerTool('snapshot', {
      title: 'Look at frames',
      description: 'Render real frames of the saved composition at the given times (about 10 s) and return them as images, so you can critique the build: framing, type size, contrast, glow, captions. Also saved to snapshots/ for the creator\'s Build step.',
      inputSchema: z.object({ project_id: projectId, at: z.array(z.number().min(0).max(1800)).min(1).max(8).describe('Times in seconds.') }),
      annotations: read,
    }, guarded('snapshot', async ({ project_id, at }) => {
      const dir = await ensureProject(user, project_id);
      await syncStyle(db, user, project_id, dir);
      if (isBlank(await readComposition(dir))) return refuse('The composition is blank. Save one with save_composition first.');
      const shots = join(dir, 'snapshots');
      await rm(shots, { recursive: true, force: true });
      try { await hyperframes(['snapshot', '--at', at.join(','), '--no-end', '--describe', 'false', dir], 180_000); }
      catch (e) { console.error('snapshot', e); return refuse('The frames could not be rendered. Run save_composition to see any errors, then try again.'); }
      // Full-size PNGs stay on disk; the client gets light JPEGs.
      await mkdir(join(DATA, 'tmp'), { recursive: true });
      const tmp = await mkdtemp(join(DATA, 'tmp', 'snap-'));
      const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
      try {
        for (const name of (await readdir(shots)).filter(f => /^frame-\d+.*\.png$/.test(f)).sort()) {
          const jpg = join(tmp, `${name}.jpg`);
          await run('ffmpeg', ['-v', 'error', '-y', '-i', join(shots, name), '-vf', 'scale=960:-2', '-q:v', '4', jpg]);
          content.push({ type: 'text', text: name.replace(/^frame-\d+-at-(.+)\.png$/, 'At $1:') }, { type: 'image', data: (await readFile(jpg)).toString('base64'), mimeType: 'image/jpeg' });
        }
      } finally { await rm(tmp, { recursive: true, force: true }); }
      if (!content.length) return refuse('No frames came back. Check the times are inside the composition.');
      await touchProject(db, project_id);
      // No structuredContent: clients that prefer it would drop the images.
      return { content: [{ type: 'text', text: `${content.length / 2} frames. Critique each against the brief, fix, save, and look again.` }, ...content] } as Result;
    }));

    server.registerTool('snapshot_board', {
      title: 'Make the beat board',
      description: 'After the creator approves the plan and before the full build: render one key frame per beat of the saved composition (the static layout of every beat is enough) and put them on the Build step as the beat board, each labelled with its beat, where the creator writes a note per frame. Replaces the previous board and its notes (a new round). Returns the frames. Then stop: ask the creator to leave notes on the board, and read them with get_board. Read get_guide("studio") first.',
      inputSchema: z.object({
        project_id: projectId,
        beats: z.array(z.object({
          at: z.number().min(0).max(1800).describe('Seconds: the moment that shows this beat best.'),
          beat: z.string().trim().min(1).max(160).describe('The beat as the plan names it, e.g. "3. Dhruv, 8 SAAL".'),
        })).min(1).max(30),
      }),
      annotations: write,
    }, guarded('snapshot_board', async ({ project_id, beats }) => {
      const ordered = [...beats].sort((a, b) => a.at - b.at);
      if (new Set(ordered.map(b => b.at.toFixed(1))).size !== ordered.length) return refuse('Two beats share a moment (to 0.1 s). Give each beat its own time.');
      const dir = await ensureProject(user, project_id);
      await syncStyle(db, user, project_id, dir);
      if (isBlank(await readComposition(dir))) return refuse('The composition is blank. Save the static layout of every beat with save_composition first.');
      const shots = join(dir, 'snapshots');
      await rm(shots, { recursive: true, force: true });
      try { await hyperframes(['snapshot', '--at', ordered.map(b => b.at).join(','), '--no-end', '--describe', 'false', dir], 300_000); }
      catch (e) { console.error('snapshot_board', e); return refuse('The frames could not be rendered. Run save_composition to see any errors, then try again.'); }
      const pngs = (await readdir(shots)).filter(f => /^frame-\d+.*\.png$/.test(f)).sort();
      if (pngs.length !== ordered.length) return refuse(`${pngs.length} of ${ordered.length} frames came back. Check every time is inside the composition.`);
      // A fresh folder per round, so the site never shows half of an old board.
      const round = ((await readBoard(user, project_id))?.round ?? 0) + 1;
      await rm(join(dir, 'board'), { recursive: true, force: true });
      await mkdir(join(dir, 'board'), { recursive: true });
      const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
      const frames = [];
      for (const [i, png] of pngs.entries()) {
        const file = `beat-${String(i + 1).padStart(2, '0')}.jpg`, small = join(dir, 'board', `.${file}`);
        await run('ffmpeg', ['-v', 'error', '-y', '-i', join(shots, png), '-vf', 'scale=1280:-2', '-q:v', '3', join(dir, 'board', file)]);
        await run('ffmpeg', ['-v', 'error', '-y', '-i', join(shots, png), '-vf', 'scale=640:-2', '-q:v', '5', small]);
        frames.push({ beat: ordered[i].beat, at: ordered[i].at, file });
        content.push({ type: 'text', text: `${ordered[i].beat} (${ordered[i].at}s):` }, { type: 'image', data: (await readFile(small)).toString('base64'), mimeType: 'image/jpeg' });
        await rm(small, { force: true });
      }
      await writeBoard(user, project_id, { round, made_at: new Date().toISOString(), frames });
      await touchProject(db, project_id);
      // No structuredContent: clients that prefer it would drop the frames.
      return { content: [{ type: 'text', text: `Beat board round ${round}: ${frames.length} frames, now on the creator's Build step. Check them yourself first; then stop and ask the creator to leave a note on any frame they want changed (Playground > Build) and to tell you when they're done. Read the notes with get_board, apply them, and only then do the full build.` }, ...content] } as Result;
    }));

    server.registerTool('get_board', {
      title: 'Read the beat board notes',
      description: 'The creator\'s notes on the beat board (one per frame, plus an overall note), with the frames they commented on as images. Apply every note before the full build; if a note changes the plan, save_plan again.',
      inputSchema: z.object({ project_id: projectId }),
      annotations: read,
    }, guarded('get_board', async ({ project_id }) => {
      const board = await readBoard(user, project_id);
      if (!board) return refuse('There is no beat board yet. Make one with snapshot_board after the plan is approved.');
      const noted = board.frames.filter(f => f.note?.trim());
      const lines = board.frames.map(f => `- ${f.beat} (${f.at}s): ${f.note?.trim() || 'no note'}`).join('\n');
      const status = !board.notes_at ? 'The creator has not saved notes on this board yet.'
        : `${noted.length} frame note(s)${board.note?.trim() ? ' and an overall note' : ''}, saved ${board.notes_at}.`;
      const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [
        { type: 'text', text: `Beat board round ${board.round}. ${status}${board.note?.trim() ? `\nOverall: ${board.note.trim()}` : ''}\n${lines}` }];
      const dir = projectDir(user, project_id);
      for (const f of noted.slice(0, 12)) {
        const bytes = await readFile(join(dir, 'board', f.file)).catch(() => null);
        if (bytes) content.push({ type: 'text', text: `${f.beat} (${f.at}s), note: ${f.note!.trim()}` }, { type: 'image', data: bytes.toString('base64'), mimeType: 'image/jpeg' });
      }
      // No structuredContent: clients that prefer it would drop the frames.
      return { content } as Result;
    }));

    // Creator styles: the look a creator's videos are built in (the creator-profile skill's files). Postgres, owner-checked here
    // because db is the service role.
    const ownStyle = async (style_id: string) => {
      const { data } = await db.from('creator_styles').select('id,name,is_default,updated_at').eq('id', style_id).eq('user_id', user).maybeSingle();
      return data as { id: string; name: string; is_default: boolean; updated_at: string } | null;
    };
    const styleId = z.string().regex(UUID).describe('Style id from list_styles or get_project.');
    const stylePath = z.string().regex(STYLE_PATH).describe('DESIGN.md, voice.md, analysis.md, style.json, tokens.css, notes.md, or cards/<tier>/<name>.html');

    server.registerTool('list_styles', {
      title: 'List creator styles',
      description: 'The creator\'s saved editing styles (look, voice, pacing, card templates). get_project says which one a project uses.',
      annotations: read,
    }, guarded('list_styles', async () => {
      const { data, error } = await db.from('creator_styles').select('id,name,is_default,updated_at').eq('user_id', user).order('updated_at', { ascending: false });
      if (error) throw error;
      return ok({ styles: data });
    }));

    server.registerTool('get_style', {
      title: 'Read a creator style',
      description: 'A creator style\'s files, each with its hash for save_style_file. Without path: DESIGN.md, style.json, tokens.css, voice.md and notes.md (the creator\'s own rules, which outrank the rest), plus a list of every file and the style cards (where to mount each and its slots). With path: that one file (analysis.md, a card template).',
      inputSchema: z.object({ style_id: styleId, path: stylePath.optional() }),
      annotations: read,
    }, guarded('get_style', async ({ style_id, path }) => {
      const style = await ownStyle(style_id);
      if (!style) return refuse('No style with that id. Call list_styles.');
      const { data, error } = await db.from('creator_style_files').select('path,text,updated_at').eq('style_id', style_id).eq('user_id', user);
      if (error) throw error;
      const files = (data ?? []) as { path: string; text: string }[];
      if (path) {
        const file = files.find(f => f.path === path);
        return file ? ok({ style: style.name, path, hash: sha256(file.text), text: file.text }) : refuse(`This style has no ${path}. Files: ${files.map(f => f.path).join(', ') || 'none'}.`);
      }
      return ok({
        style, index: files.map(f => ({ path: f.path, bytes: Buffer.byteLength(f.text) })),
        // Mount these in a project that uses this style (get_composition copies them into its style/ folder).
        cards: files.filter(f => f.path.startsWith('cards/')).map(f => ({ mount: `style/${f.path}`, slots: cardSlots(f.text).map(s => s.id) })),
        files: files.filter(f => CORE_STYLE_FILES.includes(f.path)).map(f => ({ path: f.path, hash: sha256(f.text), text: f.text })),
      });
    }));

    server.registerTool('create_style', {
      title: 'Create a creator style',
      description: 'Save a new creator style from its files, e.g. the folder the creator-profile skill wrote (DESIGN.md, voice.md, analysis.md, style.json, tokens.css, cards/<tier>/*.html). Reference videos stay on the creator\'s computer.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(80),
        files: z.array(z.object({ path: stylePath, text: z.string().max(262144) })).min(1).max(60),
        make_default: z.boolean().default(false).describe('Use it for new projects unless they pick another.'),
        request_id: requestId,
      }),
      annotations: write,
    }, guarded('create_style', async ({ name, files, make_default }) => {
      if (new Set(files.map(f => f.path)).size !== files.length) return refuse('Each path may appear once.');
      if (files.some(f => Buffer.byteLength(f.text) > 262144)) return refuse('Each file must be at most 256 KB.');
      if (make_default) await db.from('creator_styles').update({ is_default: false }).eq('user_id', user).eq('is_default', true);
      const { data: style, error } = await db.from('creator_styles').insert({ user_id: user, name, is_default: make_default }).select('id,name,is_default').single();
      if (error) throw error;
      const { error: filesError } = await db.from('creator_style_files').insert(files.map(f => ({ style_id: style.id, user_id: user, path: f.path, text: f.text })));
      if (filesError) { await db.from('creator_styles').delete().eq('id', style.id); throw filesError; }
      return ok({ style, files: files.length }, 'Saved; the creator can read and edit it on the site under Style.');
    }));

    server.registerTool('save_style_file', {
      title: 'Save a style file',
      description: 'Replace or add one file of a creator style. Only for changes the creator accepted in this conversation: propose the exact edit first and wait for a yes. Lasting preferences from feedback go in notes.md. expected_hash is the file\'s hash from get_style (use "" for a new file), so the creator\'s own edits are never overwritten.',
      inputSchema: z.object({ style_id: styleId, path: stylePath, text: z.string().max(262144), expected_hash: z.string(), request_id: requestId }),
      annotations: { ...write, idempotentHint: true },
    }, guarded('save_style_file', async ({ style_id, path, text, expected_hash }) => {
      if (!await ownStyle(style_id)) return refuse('No style with that id. Call list_styles.');
      if (Buffer.byteLength(text) > 262144) return refuse('The file must be at most 256 KB.');
      const { data: current } = await db.from('creator_style_files').select('text,updated_at').eq('style_id', style_id).eq('user_id', user).eq('path', path).maybeSingle();
      const stale = refuse(`${path} changed since you read it. Call get_style and apply the accepted edit to the current file.`);
      const now = new Date().toISOString();
      if (current) {
        if (expected_hash !== sha256(current.text)) return stale;
        const { data, error } = await db.from('creator_style_files').update({ text, updated_at: now })
          .eq('style_id', style_id).eq('user_id', user).eq('path', path).eq('updated_at', current.updated_at).select('path');
        if (error) throw error;
        if (!data?.length) return stale;
      } else {
        if (expected_hash !== '') return stale;
        const { error } = await db.from('creator_style_files').insert({ style_id, user_id: user, path, text, updated_at: now });
        if (error) return stale;
      }
      await db.from('creator_styles').update({ updated_at: now }).eq('id', style_id).eq('user_id', user);
      return ok({ saved: true, path, hash: sha256(text) }, 'Saved; the creator sees it on the site under Style.');
    }));

    // ---- Radar (Trends & News): the collected pool, the ideas the creator's Claude groups from it, and reviews.
    const runId = z.string().regex(UUID).describe('Run id from list_radar_runs.');
    server.registerTool('list_radar_runs', {
      title: 'List Radar runs',
      description: 'Recent Radar runs (weekly scans that collect videos and headlines, and daily checks of saved stories): status, what they found and cost. A done scan with no ideas yet is waiting for you: read get_guide("radar").',
      annotations: read,
    }, guarded('list_radar_runs', async () => {
      const { data, error } = await db.from('radar_runs').select('id,kind,status,error,summary,cost_micro,created_at,finished_at').eq('user_id', user).order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      const ids = (data ?? []).map(r => r.id);
      const { data: steps } = ids.length ? await db.from('radar_ai_steps').select('run_id,step,model,error,checks').in('run_id', ids) : { data: [] };
      return ok({ runs: (data ?? []).map(r => ({ ...r, cost_usd: r.cost_micro / 1e6,
        ai_steps: (steps ?? []).filter(s => s.run_id === r.id).map(s => ({ step: s.step, model: s.model, failed: !!s.error && !s.model, checks: s.checks })) })) });
    }));

    server.registerTool('get_radar_run', {
      title: 'Read a Radar run',
      description: `One Radar run in full: run.raw is the pool a scan collected (creator context, every video with views and outlier multiple x, every headline, per seed) to group into ideas with save_radar_ideas, plus each saved topic's 14-day scoring search; and the ideas the run produced with their evidence, metrics, the creator's decision and earlier reviews.`,
      inputSchema: z.object({ run_id: runId }),
      annotations: read,
    }, guarded('get_radar_run', async ({ run_id }) => {
      const { data: run, error } = await db.from('radar_runs').select('id,kind,status,error,summary,cost_micro,created_at,finished_at,raw').eq('id', run_id).eq('user_id', user).maybeSingle();
      if (error) throw error;
      if (!run) return refuse('No Radar run with that id. Call list_radar_runs.');
      const { data: steps } = await db.from('radar_ai_steps').select('id,step,idea_id,model,input,output,checks,error,ms,created_at').eq('run_id', run_id).order('created_at');
      const ideaIds = [...new Set((steps ?? []).flatMap(s => s.idea_id ? [s.idea_id] : []))];
      const { data: ideas } = await db.from('radar_ideas').select('id,name,summary,angle,bucket,status,label,score,metrics,evidence,change_note,last_checked')
        .eq('user_id', user).or(ideaIds.length ? `run_id.eq.${run_id},id.in.(${ideaIds.join(',')})` : `run_id.eq.${run_id}`);
      const { data: reviews } = (ideas ?? []).length ? await db.from('radar_reviews').select('idea_id,reviewer,model,verdict,notes,suggestion,created_at').in('idea_id', ideas!.map(i => i.id)) : { data: [] };
      return ok({ run, ai_steps: steps ?? [], ideas: (ideas ?? []).map(i => ({ ...i, reviews: (reviews ?? []).filter(r => r.idea_id === i.id) })) });
    }));

    server.registerTool('save_radar_ideas', {
      title: 'Save Radar ideas from a scan',
      description: `Group a finished scan's pool into 4 to 10 video ideas and save them for the creator. Read get_guide("radar") and get_radar_run first. Every video_ids / news_urls entry must be copied exactly from run.raw; a topic with fewer than two is dropped. The server scores them and replaces last week's undecided ideas; saved, dropped and archived ones stay.`,
      inputSchema: z.object({
        run_id: runId,
        topics: z.array(z.object({
          name: z.string().max(120).describe('A concrete event, decision or question in plain English.'),
          summary: z.string().max(600).describe('One or two sentences using only the listed titles and headlines.'),
          angle: z.string().max(400).describe('How this creator could explain it, in their buckets.'),
          keywords: z.array(z.string().max(60)).min(1).max(5),
          query: z.string().max(100).describe('The best YouTube search for it.'),
          bucket: z.string().nullable().describe('One of creator.buckets, copied exactly, or null.'),
          video_ids: z.array(z.string()),
          news_urls: z.array(z.string()),
        })).min(1).max(12),
        request_id: requestId,
      }),
      annotations: write,
    }, guarded('save_radar_ideas', async ({ run_id, topics }) => {
      try { return ok(await saveIdeas(db, user, run_id, { topics }), 'Saved; the creator sees the ideas under Trends & News.'); }
      catch (e) { if (e instanceof JobError) return refuse(e.message); throw e; }
    }));

    server.registerTool('review_radar_idea', {
      title: 'Review a Radar idea',
      description: `Leave your review of one Radar idea (yours or an earlier one): keep, fix (with the corrected name, summary or angle) or drop, with short notes for the creator. It shows on the idea card. It never changes the creator's decision.`,
      inputSchema: z.object({
        idea_id: z.string().regex(UUID).describe('Idea id from get_radar_run.'),
        verdict: z.enum(['keep', 'fix', 'drop']),
        notes: z.string().trim().min(1).max(2000).describe('Why, in a sentence or two the creator can read quickly. Say what you could not verify.'),
        reviewer: z.enum(['claude', 'codex', 'other']).describe('Who you are.'),
        model: z.string().max(80).optional().describe('Your model name, if you know it.'),
        suggested_name: z.string().max(120).optional(),
        suggested_summary: z.string().max(600).optional(),
        suggested_angle: z.string().max(400).optional(),
        request_id: requestId,
      }),
      annotations: write,
    }, guarded('review_radar_idea', async ({ idea_id, verdict, notes, reviewer, model, suggested_name, suggested_summary, suggested_angle }) => {
      const { data: idea } = await db.from('radar_ideas').select('id,name').eq('id', idea_id).eq('user_id', user).maybeSingle();
      if (!idea) return refuse('No Radar idea with that id. Call get_radar_run.');
      if (verdict === 'fix' && !suggested_name && !suggested_summary && !suggested_angle) return refuse('A "fix" needs at least one of suggested_name, suggested_summary or suggested_angle.');
      const suggestion = Object.fromEntries(Object.entries({ name: suggested_name, summary: suggested_summary, angle: suggested_angle }).filter(([, v]) => v?.trim()));
      const { error } = await db.from('radar_reviews').insert({ user_id: user, idea_id, reviewer, model: model ?? null, verdict, notes, suggestion });
      if (error) throw error;
      return ok({ saved: true, idea: idea.name, verdict }, 'Saved; the creator sees your review on the idea card under Trends & News.');
    }));

    // ---- Planner: outlines for planned videos, most often Radar topics the creator added.
    const planItemId = z.string().regex(UUID).describe('Plan item id from list_plan_items.');
    server.registerTool('list_plan_items', {
      title: 'List planned videos',
      description: 'The creator\'s planned videos that are not posted yet: title, status, day, whether it came from a Trends & News idea and whether it has an outline. Read get_guide("outline") before outlining one.',
      annotations: read,
    }, guarded('list_plan_items', async () => {
      const { data, error } = await db.from('plan_items').select('id,title,status,format,platform,scheduled_on,radar_idea_id,outline_at,created_at')
        .eq('user_id', user).neq('status', 'posted').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return ok({ items: (data ?? []).map(({ radar_idea_id, outline_at, ...i }) => ({ ...i, from_trends: !!radar_idea_id, outline_saved_at: outline_at })) });
    }));

    server.registerTool('get_plan_item', {
      title: 'Read a planned video',
      description: 'One planned video with everything to outline it from: its notes and current outline; for a Trends & News topic, the idea (summary, angle, bucket, metrics), its evidence, daily updates and reviews, plus the headlines and videos from the scan\'s raw pool that match the topic (titles only: open the links for the facts); the creator\'s channel (recent titles, buckets, format) and default style id.',
      inputSchema: z.object({ plan_item_id: planItemId }),
      annotations: read,
    }, guarded('get_plan_item', async ({ plan_item_id }) => {
      const { data: item, error } = await db.from('plan_items').select('id,title,notes,status,format,platform,scheduled_on,radar_idea_id,outline,outline_at').eq('id', plan_item_id).eq('user_id', user).maybeSingle();
      if (error) throw error;
      if (!item) return refuse('No planned video with that id. Call list_plan_items.');
      const [{ data: profile }, { data: style }] = await Promise.all([
        db.from('radar_profiles').select('format,region,buckets,channel').eq('user_id', user).maybeSingle(),
        db.from('creator_styles').select('id,name').eq('user_id', user).eq('is_default', true).maybeSingle(),
      ]);
      const channel = profile && { ...profile, channel: profile.channel && { name: profile.channel.name, subs: profile.channel.subs, recent_titles: profile.channel.titles } };
      const { radar_idea_id, ...planned } = item;
      const idea = radar_idea_id ? (await db.from('radar_ideas').select('id,run_id,name,summary,angle,bucket,keywords,query,label,metrics,evidence,change_note,status').eq('id', radar_idea_id).eq('user_id', user).maybeSingle()).data : null;
      if (!idea) return ok({ item: planned, idea: null, channel, default_style: style ?? null });
      const [{ data: updates }, { data: reviews }, { data: run }] = await Promise.all([
        db.from('radar_updates').select('kind,title,url,source,published,found_at').eq('idea_id', idea.id).order('found_at', { ascending: false }).limit(50),
        db.from('radar_reviews').select('reviewer,model,verdict,notes,suggestion,created_at').eq('idea_id', idea.id).order('created_at', { ascending: false }),
        idea.run_id ? db.from('radar_runs').select('raw').eq('id', idea.run_id).eq('user_id', user).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      // The scan saw far more than the model grouped; hand over what matches this topic so nothing collected is lost.
      const raw = (run?.raw ?? {}) as { videos?: { title: string }[]; news?: { title: string }[] }, match = [...idea.keywords, idea.name];
      const related = { videos: (raw.videos ?? []).filter(v => onTopic(v.title, match)), news: (raw.news ?? []).filter(n => onTopic(n.title, match)) };
      return ok({ item: planned, idea: { ...idea, updates: updates ?? [], reviews: reviews ?? [] }, related, channel, default_style: style ?? null });
    }));

    server.registerTool('save_outline', {
      title: 'Save a video outline',
      description: 'Save the outline of a planned video as markdown: sections with time ranges and talking points, each fact with its source, unverified points marked ⚠️, then the sources. Follow get_guide("outline"). It replaces the item\'s previous outline and shows in the Planner at once.',
      inputSchema: z.object({ plan_item_id: planItemId, outline: z.string().trim().min(200).max(40000), request_id: requestId }),
      annotations: { ...write, idempotentHint: true },
    }, guarded('save_outline', async ({ plan_item_id, outline }) => {
      if (!/^##\s/m.test(outline)) return refuse('Give the outline its sections as "## " headings (see get_guide("outline")).');
      const now = new Date().toISOString();
      const { data, error } = await db.from('plan_items').update({ outline, outline_at: now, updated_at: now }).eq('id', plan_item_id).eq('user_id', user).select('id,title');
      if (error) throw error;
      if (!data?.length) return refuse('No planned video with that id. Call list_plan_items.');
      return ok({ saved: true, title: data[0].title }, 'Saved; the creator sees the outline when they open this video in the Planner.');
    }));

    return server;
  });
}

// Who is calling: an access token from Supabase Auth's OAuth server (a site session token is not accepted).
function verifier(userFor: (token: string) => Promise<string | null>) {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const user = await userFor(token);
      let claims: { client_id?: string; exp?: number; scope?: string } = {};
      try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { /* refused below */ }
      if (!user || !claims.client_id || !claims.exp) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Sign in again.');
      return { token, clientId: claims.client_id, scopes: claims.scope?.split(' ') ?? [], expiresAt: claims.exp, extra: { user } };
    },
  };
}

const originOf = (c: Context) => `${c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.slice(0, -1)}://${c.req.header('x-forwarded-host') ?? c.req.header('host')}`;

export function mountMcp(app: Hono<any>, db: SupabaseClient, { supabaseUrl, userFor }: { supabaseUrl: string; userFor: (token: string) => Promise<string | null> }) {
  const handler = createMcp(db);
  const verify = verifier(userFor);

  // Supabase Auth is the authorization server; clients discover it from here (RFC 9728 / RFC 8414).
  let asMetadata: Promise<OAuthMetadata> | null = null;
  const authServer = () => asMetadata ??= fetch(`${supabaseUrl}/.well-known/oauth-authorization-server/auth/v1`)
    .then(r => { if (!r.ok) throw new Error(`OAuth discovery ${r.status}`); return r.json(); })
    .catch(e => { asMetadata = null; throw e; });
  const metadata = async (c: Context) => ({ oauthMetadata: await authServer(), resourceServerUrl: new URL('/mcp', originOf(c)), resourceName: 'Creator Platform', scopesSupported: [] });

  app.use('/.well-known/*', async (c, next) => {
    if (!c.req.path.startsWith('/.well-known/oauth-')) return next();
    let res: Response | undefined;
    try { res = oauthMetadataResponse(c.req.raw, await metadata(c)); }
    catch (e) { console.error('mcp metadata', e); return c.json({ error: 'Sign-in for Claude is not set up yet.' }, 503); }
    return res ?? next();
  });

  app.all('/mcp', async c => {
    const origin = originOf(c);
    const rejected = originValidationResponse(c.req.raw, [new URL(origin).hostname, 'localhost', '127.0.0.1', '[::1]']);
    if (rejected) return rejected;
    const auth = await requireBearerAuth({ verifier: verify, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL('/mcp', origin)) })(c.req.raw);
    if (auth instanceof Response) return auth;
    auth.extra = { ...auth.extra, origin };
    return handler.fetch(c.req.raw, { authInfo: auth });
  });

  // Short-lived read links from prepare_generation: Higgsfield pulls the references, the API kit reads its manifest.
  app.get('/mcp-download/:token', async c => {
    const item = downloads.get(c.req.param('token'));
    if (!item || item.until < Date.now()) return c.json({ error: 'This link has expired. Call prepare_generation again.' }, 404);
    if (item.json) return c.json(item.json);
    return await sendFile(item.path!, c.req.header('range')) ?? c.json({ error: 'not found' }, 404);
  });

  // Single-use upload links from create_upload_url (the agent PUTs bytes here; nothing large crosses MCP).
  app.put('/mcp-upload/:token', async c => {
    const token = c.req.param('token'), upload = uploads.get(token);
    uploads.delete(token);
    if (!upload || upload.until < Date.now()) return c.json({ error: 'This upload link has expired. Ask for a new one.' }, 404);
    if (!await hasRoom(Number(c.req.header('content-length')) || upload.limit)) return c.json({ error: 'The server is out of space for uploads right now.' }, 507);
    try { await saveBody(c.req.raw, upload.path, upload.limit); }
    catch (e) { return c.json({ error: e instanceof UploadError ? e.message : 'The upload failed. Please try again.' }, 400); }
    await touchProject(db, upload.project);
    return c.json({ ok: true });
  });
}
