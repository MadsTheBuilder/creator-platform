// Contract test: a real MCP client (2026-07-28 and 2025-era) against the real tools, with an in-memory Supabase
// and a scratch DATA_DIR. Run: npm test (in worker/).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'mcp-test-'));
const { createMcp } = await import('./mcp.ts');
const { latestBreakdown, projectDir } = await import('./project-files.ts');

// Just enough of supabase-js's query builder for the tools: filters, order, limit, single rows, insert/update.
type Row = Record<string, any>;
function fakeDb(tables: Record<string, Row[]>) {
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    let filters: ((r: Row) => boolean)[] = [], order: [string, boolean] | null = null, limit = Infinity;
    let action: 'select' | 'insert' | 'update' | 'delete' = 'select', payload: Row | Row[] = {};
    const result = () => {
      if (action === 'insert') return [payload].flat().map(p => {
        const row = { id: crypto.randomUUID(), status: 'queued', created_at: new Date(Date.now() + rows.length).toISOString(), ...p };
        rows.push(row);
        return row;
      });
      let out = rows.filter(r => filters.every(f => f(r)));
      if (action === 'update') { out.forEach(r => Object.assign(r, payload)); return out; }
      if (action === 'delete') { out.forEach(r => rows.splice(rows.indexOf(r), 1)); return out; }
      if (order) { const [k, asc] = order; out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1)); }
      return out.slice(0, limit);
    };
    const q: any = {
      select: () => q, eq: (k: string, v: unknown) => (filters.push(r => r[k] === v), q), gt: (k: string, v: any) => (filters.push(r => r[k] > v), q),
      lt: (k: string, v: any) => (filters.push(r => r[k] < v), q), in: (k: string, v: unknown[]) => (filters.push(r => v.includes(r[k])), q),
      order: (k: string, o?: { ascending?: boolean }) => (order = [k, o?.ascending ?? true], q), limit: (n: number) => (limit = n, q),
      insert: (row: Row | Row[]) => (action = 'insert', payload = row, q), update: (row: Row) => (action = 'update', payload = row, q), delete: () => (action = 'delete', q),
      single: async () => { const r = result(); return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: 'not one row' } }; },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(ok, bad),
    };
    return q;
  };
  return { from } as any;
}

const ME = crypto.randomUUID(), SOMEONE = crypto.randomUUID(), MINE = crypto.randomUUID(), THEIRS = crypto.randomUUID();
const tables: Record<string, Row[]> = {
  projects: [
    { id: MINE, user_id: ME, name: 'Red balloon', track: 'production', direction: '', beat_plan: '', script: 'VO: A red balloon drifts over Mirzapur.', updated_at: '2026-10-01T00:00:00Z' },
    { id: THEIRS, user_id: SOMEONE, name: 'Not mine', track: 'production', direction: '', beat_plan: '', script: '', updated_at: '2026-10-01T00:00:00Z' },
  ],
  video_jobs: [], bridge_devices: [], creator_styles: [], creator_style_files: [],
};
const db = fakeDb(tables);
const handler = createMcp(db);

async function connect(mode: 'modern' | 'legacy') {
  const authInfo = { token: 't', clientId: 'test', scopes: [], expiresAt: Date.now() / 1000 + 3600, extra: { user: ME, origin: 'https://app.test' } };
  const transport = new StreamableHTTPClientTransport(new URL('https://app.test/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo }),
  });
  const client = new Client({ name: 'contract-test', version: '1' }, mode === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {});
  await client.connect(transport);
  return client;
}
const call = (client: Client, name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<any>;

const shot = (n: number) => ({ description: `Shot ${n}`, magnification: 'MS', movement: 'Slow push in', lens: '35', angle: 'Eye level', position: '2 m in front, 1.5 m high', lighting: 'Soft key camera left, 5600K', notes: '', audio: 'VO: A red balloon drifts over Mirzapur.', duration: 4 });
const storyboard = { title: 'Red Balloon', brief: 'A boy and a balloon.', scenes: [{ heading: 'Scene 1 - EXT. Ghat - Dawn', lighting: 'Soft dawn, 4000K', shots: [shot(1), shot(2)] }] };
const vision = { format: 'Short film', method: 'AI-generated', aspect: '9:16', runtime: 8, feel: 'Quiet, warm' };

for (const mode of ['modern', 'legacy'] as const) {
  test(`tools are listed in a stable order (${mode})`, async () => {
    const client = await connect(mode);
    assert.equal(client.getNegotiatedProtocolVersion() === '2026-07-28', mode === 'modern');
    assert.match(client.getServerVersion()?.version ?? '', /\w/);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name), ['get_guide', 'list_projects', 'create_project', 'get_project', 'save_script', 'get_breakdown', 'save_breakdown',
      'seed_composition', 'get_composition', 'save_composition', 'list_references', 'create_upload_url', 'queue_blockout', 'get_job', 'get_blockout',
      'get_transcript', 'transcribe_recording', 'fix_transcript', 'save_plan', 'analyze_beats', 'snapshot',
      'list_styles', 'get_style', 'create_style', 'save_style_file']);
    assert.ok(tools.every(t => t.description && t.annotations));
    await client.close();
  });
}

test('only the caller\'s projects', async () => {
  const client = await connect('modern');
  const list = await call(client, 'list_projects');
  assert.deepEqual(list.structuredContent.projects.map((p: Row) => p.id), [MINE]);
  const theirs = await call(client, 'get_project', { project_id: THEIRS });
  assert.equal(theirs.isError, true);
  await client.close();
});

test('a project keeps the track it was created with', async () => {
  const client = await connect('modern');
  const studio = await call(client, 'create_project', { name: 'Hook test', track: 'studio' });
  const plain = await call(client, 'create_project', { name: 'Plain' });
  assert.equal(plain.structuredContent.project.track, 'production');
  const got = await call(client, 'get_project', { project_id: studio.structuredContent.project.id });
  assert.equal(got.structuredContent.project.track, 'studio');
  const bad = await call(client, 'create_project', { name: 'Bad', track: 'film' });
  assert.equal(bad.isError, true);
  await client.close();
});

test('a saved breakdown is what the site reads', async () => {
  const client = await connect('modern');
  const bad = await call(client, 'save_breakdown', { project_id: MINE, vision, storyboard: { ...storyboard, scenes: [{ ...storyboard.scenes[0], shots: [{ ...shot(1), duration: 0 }] }] } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /shot 1 duration/);

  const saved = await call(client, 'save_breakdown', { project_id: MINE, vision, storyboard, request_id: 'once' });
  assert.equal(saved.isError, undefined);
  assert.match(saved.structuredContent.message, /seed_composition/);
  const again = await call(client, 'save_breakdown', { project_id: MINE, vision, storyboard, request_id: 'once' });
  assert.equal(again.structuredContent.breakdown_id, saved.structuredContent.breakdown_id);
  assert.equal(tables.video_jobs.filter(j => j.kind === 'breakdown').length, 1);

  // The site's own reader (Shots tab, Studio seed, Blender bridge) accepts it.
  const latest = await latestBreakdown(db, ME, MINE);
  assert.equal(latest?.storyboard.aspect, '9:16');
  assert.equal(latest?.source, 'mcp');

  const blockout = await call(client, 'queue_blockout', { project_id: MINE, shots: [3] });
  assert.equal(blockout.isError, true);
  const queued = await call(client, 'queue_blockout', { project_id: MINE, shots: [2, 1, 2] });
  assert.deepEqual(queued.structuredContent.shots, [1, 2]);
  assert.equal(queued.structuredContent.blender_helper_online, false);
  await client.close();
});

test('saves refuse stale versions', async () => {
  const client = await connect('modern');
  const project = await call(client, 'get_project', { project_id: MINE });
  const stale = await call(client, 'save_script', { project_id: MINE, script: 'New', expected_script_hash: 'old' });
  assert.equal(stale.isError, true);
  const fresh = await call(client, 'save_script', { project_id: MINE, script: 'New', expected_script_hash: project.structuredContent.project.script_hash });
  assert.equal(fresh.structuredContent.saved, true);

  const seeded = await call(client, 'seed_composition', { project_id: MINE });
  assert.equal(seeded.structuredContent.seeded, true);
  const twice = await call(client, 'seed_composition', { project_id: MINE });
  assert.equal(twice.isError, true);
  const composition = await call(client, 'save_composition', { project_id: MINE, html: '<html></html>', expected_hash: 'old' });
  assert.equal(composition.isError, true);
  assert.match(composition.content[0].text, /changed since you read it/);
  await client.close();
});

test('guides come from the server', async () => {
  const client = await connect('modern');
  for (const topic of ['breakdown', 'script', 'composition', 'blockout', 'studio']) {
    const guide = await call(client, 'get_guide', { topic });
    assert.ok(guide.structuredContent.guide.length > 500, topic); // Claude Code reads structuredContent only
  }
  await client.close();
});

test('save_composition runs hyperframes check before writing', { timeout: 240_000 }, async () => {
  const client = await connect('modern');
  const current = await call(client, 'get_composition', { project_id: MINE });
  const broken = await call(client, 'save_composition', { project_id: MINE, html: '<html><body><div data-composition-id="x">', expected_hash: current.structuredContent.hash });
  assert.equal(broken.isError, true);
  assert.ok(broken.structuredContent.errors.length > 0);
  // The reasons are in the text too, which is all Claude Code shows the model for an error.
  assert.ok(broken.content[0].text.includes(broken.structuredContent.errors[0].code));
  const edited = current.structuredContent.html.replace('Red Balloon', 'The Red Balloon');
  const saved = await call(client, 'save_composition', { project_id: MINE, html: edited, expected_hash: current.structuredContent.hash });
  assert.equal(saved.structuredContent.saved, true, saved.content[0].text);
  assert.equal(saved.structuredContent.checked, true);
  const after = await call(client, 'get_composition', { project_id: MINE });
  assert.equal(after.structuredContent.hash, saved.structuredContent.hash);
  await client.close();
});

test('studio: transcript, beat plan, uploads and beats', { timeout: 120_000 }, async () => {
  const client = await connect('modern');
  const { structuredContent: { project } } = await call(client, 'create_project', { name: 'Talking head', track: 'studio' });
  const none = await call(client, 'get_transcript', { project_id: project.id });
  assert.equal(none.isError, true);

  const dir = projectDir(ME, project.id);
  await mkdir(join(dir, 'media'), { recursive: true });
  await writeFile(join(dir, 'transcript.json'), JSON.stringify([{ text: 'Namaste', start: 0.2, end: 0.6 }, { text: 'dosto.', start: 0.7, end: 1.1 }]));
  const transcript = await call(client, 'get_transcript', { project_id: project.id });
  assert.equal(transcript.structuredContent.words, 2);
  assert.equal(transcript.structuredContent.transcript, '0.20 0.60 Namaste\n0.70 1.10 dosto.');

  const fixed = await call(client, 'fix_transcript', { project_id: project.id, edits: [{ index: 0, text: 'Namaste,' }] });
  assert.equal(fixed.structuredContent.changed, 1);
  const outOfRange = await call(client, 'fix_transcript', { project_id: project.id, edits: [{ index: 2, text: 'x' }] });
  assert.equal(outOfRange.isError, true);
  assert.match((await call(client, 'get_transcript', { project_id: project.id })).structuredContent.transcript, /^0\.20 0\.60 Namaste,\n/);

  const plan = await call(client, 'save_plan', { project_id: project.id, plan: 'Brief: one line of light.\n0-2 s · Namaste · the line wakes · whoosh' });
  assert.equal(plan.structuredContent.saved, true);
  assert.match(await readFile(join(dir, 'BRIEF.md'), 'utf8'), /one line of light/);
  const got = await call(client, 'get_project', { project_id: project.id });
  assert.match(got.structuredContent.project.beat_plan, /one line of light/);
  assert.deepEqual(got.structuredContent.transcript, { words: 2, seconds: 1.1 });

  const noShot = await call(client, 'create_upload_url', { project_id: project.id, name: 'a.jpg' });
  assert.equal(noShot.isError, true);
  const wrongKind = await call(client, 'create_upload_url', { project_id: project.id, target: 'media', name: 'cover.jpg' });
  assert.equal(wrongKind.isError, true);
  const upload = await call(client, 'create_upload_url', { project_id: project.id, target: 'media', name: 'whoosh.wav' });
  assert.equal(upload.structuredContent.path, 'media/whoosh.wav');
  const missing = await call(client, 'transcribe_recording', { project_id: project.id, file: 'take.mp4' });
  assert.equal(missing.isError, true);

  // A click every half second: 120 BPM.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.03),sin(2*PI*880*t),0)':d=8", join(dir, 'media', 'clicks.wav')]);
  const beats = await call(client, 'analyze_beats', { project_id: project.id, file: 'clicks.wav' });
  assert.equal(beats.isError, undefined, beats.content[0].text);
  assert.ok(beats.structuredContent.count >= 10);

  // Speech to text runs on the creator's computer: a one-job key for their Claude Code, or a job for the helper.
  const queued = await call(client, 'transcribe_recording', { project_id: project.id, file: 'clicks.wav', on: 'helper' });
  assert.equal(queued.structuredContent.status, 'queued');
  const here = await call(client, 'transcribe_recording', { project_id: project.id, file: 'clicks.wav' });
  assert.equal(here.structuredContent.status, 'running');
  assert.equal(here.structuredContent.script_url, 'https://app.test/kit/transcribe.py');
  assert.match(here.content[0].text, new RegExp(`python transcribe.py "https://app.test/bridge/jobs/${here.structuredContent.job_id}" "${here.structuredContent.key}"`));
  const jobs = tables.video_jobs.filter(j => j.project_id === project.id && j.kind === 'transcribe');
  assert.deepEqual(jobs.map(j => j.status), ['failed', 'running']); // the newer one replaces the queued one
  assert.equal(jobs[1].input.on, 'claude');
  await client.close();
});

test('snapshot returns real frames of the saved composition', { timeout: 240_000 }, async () => {
  const client = await connect('modern');
  const frames = await call(client, 'snapshot', { project_id: MINE, at: [0.5, 2] });
  assert.equal(frames.isError, undefined, frames.content[0].text);
  assert.equal(frames.content.filter((c: Row) => c.type === 'image').length, 2);
  await client.close();
});

test('studio: Devanagari words are flagged for conversion to Roman, timings kept', async () => {
  const client = await connect('modern');
  const { structuredContent: { project } } = await call(client, 'create_project', { name: 'Hinglish', track: 'studio' });
  const job = (writing: string) => ({ id: crypto.randomUUID(), user_id: ME, project_id: project.id, kind: 'transcribe', status: 'done',
    input: { file: 'take.m4a', language: 'hi', writing }, output: { file: 'media/recording.m4a', seconds: 2, words: 3, video: false }, error: null,
    created_at: new Date(Date.now() + tables.video_jobs.length * 1000).toISOString() });
  tables.video_jobs.push(job('roman'));
  const dir = projectDir(ME, project.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'transcript.json'), JSON.stringify([{ text: 'शाम', start: 0.1, end: 0.4 }, { text: 'के', start: 0.4, end: 0.5 }, { text: 'Mirzapur', start: 0.6, end: 1.2 }]));

  const got = await call(client, 'get_project', { project_id: project.id });
  assert.equal(got.structuredContent.transcription.writing, 'roman');
  assert.equal(got.structuredContent.transcription.language, 'hi');

  const before = await call(client, 'get_transcript', { project_id: project.id });
  assert.equal(before.structuredContent.devanagari, 2);
  assert.match(before.structuredContent.note, /fix_transcript/);
  assert.match(before.structuredContent.note, /Roman/);

  const fixed = await call(client, 'fix_transcript', { project_id: project.id, edits: [{ index: 0, text: 'Shaam' }, { index: 1, text: 'ke' }] });
  assert.equal(fixed.structuredContent.changed, 2);
  const after = await call(client, 'get_transcript', { project_id: project.id });
  assert.equal(after.structuredContent.devanagari, 0);
  assert.equal(after.structuredContent.note, undefined);
  assert.equal(after.structuredContent.transcript, '0.10 0.40 Shaam\n0.40 0.50 ke\n0.60 1.20 Mirzapur');

  // A creator who chose Devanagari is not asked to convert.
  await writeFile(join(dir, 'transcript.json'), JSON.stringify([{ text: 'शाम', start: 0.1, end: 0.4 }]));
  tables.video_jobs.push(job('devanagari'));
  const dev = await call(client, 'get_transcript', { project_id: project.id });
  assert.equal(dev.structuredContent.devanagari, 1);
  assert.equal(dev.structuredContent.note, undefined);

  const guide = (await call(client, 'get_guide', { topic: 'studio' })).structuredContent.guide;
  for (const word of ['Devanagari', 'Roman', 'fix_transcript']) assert.match(guide, new RegExp(word));
  const tools = (await client.listTools()).tools;
  assert.match(tools.find(t => t.name === 'fix_transcript')!.description!, /Devanagari/);
  await client.close();
});

test('the whisper prompt is the project script or nothing (no seed sentence)', async () => {
  const { settings } = await import('./transcribe.ts');
  const BLANK = crypto.randomUUID(), SCRIPTED = crypto.randomUUID();
  tables.projects.push({ id: BLANK, user_id: ME, script: '' }, { id: SCRIPTED, user_id: ME, script: 'Shaam ke 7 baj rahe the.' });
  const job = (project_id: string, writing: string, language = 'hi') => ({ id: 'j', user_id: ME, project_id, input: { file: 'x.m4a', language, writing } });
  assert.deepEqual(await settings(db, job(BLANK, 'roman')), { language: 'hi', prompt: '' });
  assert.deepEqual(await settings(db, job(BLANK, 'devanagari')), { language: 'hi', prompt: '' });
  assert.deepEqual(await settings(db, job(BLANK, 'roman', 'en')), { language: 'en', prompt: '' });
  assert.deepEqual(await settings(db, job(SCRIPTED, 'roman')), { language: 'hi', prompt: 'Shaam ke 7 baj rahe the.' });
});

test('a Studio project keeps project-wide references (shot 0) next to per-shot ones', async () => {
  const { refPath } = await import('./project-files.ts');
  const client = await connect('modern');
  const { structuredContent: { project } } = await call(client, 'create_project', { name: 'Refs', track: 'studio' });
  assert.ok(refPath(ME, project.id, 0, 'look.png'));
  assert.equal(refPath(ME, project.id, -1, 'look.png'), null);
  for (const [shot, name] of [[0, 'look.png'], [2, 'cam.mp4']] as const) {
    const path = refPath(ME, project.id, shot, name)!;
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'x');
  }
  const refs = (await call(client, 'list_references', { project_id: project.id })).structuredContent.references;
  assert.deepEqual(refs.map((r: Row) => [r.shot, r.name]).sort(), [[0, 'look.png'], [2, 'cam.mp4']]);
  await client.close();
});

test('list_references shows the model each reference: images, and videos as a frame sheet', { timeout: 120_000 }, async () => {
  const { refPath } = await import('./project-files.ts');
  const client = await connect('modern');
  const { structuredContent: { project } } = await call(client, 'create_project', { name: 'Look refs', track: 'studio' });
  const still = refPath(ME, project.id, 0, 'look.png')!, clip = refPath(ME, project.id, 0, 'motion.mp4')!;
  await mkdir(join(still, '..'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180', '-frames:v', '1', still]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=d=4:s=320x180:r=25', '-pix_fmt', 'yuv420p', clip]);
  const result = await call(client, 'list_references', { project_id: project.id });
  assert.equal(result.content.filter((c: Row) => c.type === 'image').length, 2);
  assert.match(result.content[0].text, /motion\.mp4/);
  // The cached sheet is not itself a reference.
  assert.equal(JSON.parse((await call(client, 'list_references', { project_id: project.id })).content[0].text).references.length, 2);
  await client.close();
});

test('creator styles: owned, default for new projects, saved only against the current hash', async () => {
  const client = await connect('modern');
  tables.creator_styles.push({ id: crypto.randomUUID(), user_id: SOMEONE, name: 'Theirs', is_default: true, updated_at: '2026-10-01T00:00:00Z' });
  const bad = await call(client, 'create_style', { name: 'Bad', files: [{ path: '../index.html', text: 'x' }] });
  assert.equal(bad.isError, true);
  const made = await call(client, 'create_style', { name: 'Indian Lawtuber', make_default: true, files: [
    { path: 'DESIGN.md', text: '# Documentary noir' }, { path: 'style.json', text: '{"palette":{"bg":"#0b0b0c"}}' }, { path: 'analysis.md', text: 'long' },
    { path: 'cards/tier1/t1-stat-redtear.html', text: '<div></div>' }] });
  const id = made.structuredContent.style.id;
  assert.deepEqual((await call(client, 'list_styles')).structuredContent.styles.map((s: Row) => s.name), ['Indian Lawtuber']);

  const style = await call(client, 'get_style', { style_id: id });
  assert.deepEqual(style.structuredContent.files.map((f: Row) => f.path).sort(), ['DESIGN.md', 'style.json']);
  assert.equal(style.structuredContent.index.length, 4);
  assert.equal((await call(client, 'get_style', { style_id: id, path: 'cards/tier1/t1-stat-redtear.html' })).structuredContent.text, '<div></div>');
  const theirs = tables.creator_styles.find(s => s.user_id === SOMEONE)!;
  assert.equal((await call(client, 'get_style', { style_id: theirs.id })).isError, true);

  const project = await call(client, 'create_project', { name: 'Styled', track: 'studio' });
  assert.equal(project.structuredContent.project.style_id, id);
  assert.equal((await call(client, 'get_project', { project_id: project.structuredContent.project.id })).structuredContent.style.name, 'Indian Lawtuber');
  assert.equal((await call(client, 'create_project', { name: 'Plain', style_id: null })).structuredContent.project.style_id, null);
  assert.equal((await call(client, 'create_project', { name: 'Stolen', style_id: theirs.id })).isError, true);

  const design = style.structuredContent.files.find((f: Row) => f.path === 'DESIGN.md');
  assert.equal((await call(client, 'save_style_file', { style_id: id, path: 'DESIGN.md', text: 'x', expected_hash: '0'.repeat(64) })).isError, true);
  assert.equal((await call(client, 'save_style_file', { style_id: id, path: 'DESIGN.md', text: '# Cream paper', expected_hash: design.hash })).structuredContent.saved, true);
  assert.equal((await call(client, 'save_style_file', { style_id: id, path: 'notes.md', text: 'Captions bigger.', expected_hash: '' })).structuredContent.saved, true);
  assert.equal((await call(client, 'save_style_file', { style_id: id, path: 'notes.md', text: 'Again', expected_hash: '' })).isError, true);
  assert.equal((await call(client, 'save_style_file', { style_id: theirs.id, path: 'notes.md', text: 'x', expected_hash: '' })).isError, true);
  const after = await call(client, 'get_style', { style_id: id });
  assert.equal(after.structuredContent.files.find((f: Row) => f.path === 'DESIGN.md').text, '# Cream paper');
  assert.ok(after.structuredContent.files.some((f: Row) => f.path === 'notes.md'));
  assert.deepEqual(after.structuredContent.cards, [{ mount: 'style/cards/tier1/t1-stat-redtear.html', slots: [] }]);

  // The project's folder gets the style's cards as mountable sub-compositions, and loses them with the style.
  const pid = project.structuredContent.project.id;
  const card = '<html><head><link rel="stylesheet" href="../../tokens.css"></head><body><div id="c" data-composition-id="c"><div data-slot="stat">$6 Billion</div></div>'
    + '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><script>window.__timelines={c:gsap.timeline({paused:true})}</script></body></html>';
  await call(client, 'save_style_file', { style_id: id, path: 'cards/tier1/t1-stat-redtear.html', text: card,
    expected_hash: (await call(client, 'get_style', { style_id: id, path: 'cards/tier1/t1-stat-redtear.html' })).structuredContent.hash });
  await call(client, 'save_style_file', { style_id: id, path: 'tokens.css', text: ':root{--red:#e10a14}', expected_hash: '' });
  await call(client, 'get_composition', { project_id: pid });
  const mounted = await readFile(join(projectDir(ME, pid), 'style/cards/tier1/t1-stat-redtear.html'), 'utf8');
  assert.match(mounted, /data-composition-variables='\[\{"id":"stat","type":"string","label":"stat","default":"\$6 Billion"\}\]'/);
  assert.match(mounted, /<script src="\.\.\/\.\.\/\.\.\/gsap\.min\.js"><\/script><script>/);
  assert.doesNotMatch(mounted, /cdn\.jsdelivr/);
  assert.equal(await readFile(join(projectDir(ME, pid), 'style/tokens.css'), 'utf8'), ':root{--red:#e10a14}');
  tables.projects.find(p => p.id === pid)!.style_id = null;
  await call(client, 'get_composition', { project_id: pid });
  await assert.rejects(readFile(join(projectDir(ME, pid), 'style/tokens.css'), 'utf8'));
  await client.close();
});
