// Contract test: a real MCP client (2026-07-28 and 2025-era) against the real tools, with an in-memory Supabase
// and a scratch DATA_DIR. Run: npm test (in worker/).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
      select: () => q, eq: (k: string, v: unknown) => (filters.push(r => r[k] === v), q), neq: (k: string, v: unknown) => (filters.push(r => r[k] !== v), q), gt: (k: string, v: any) => (filters.push(r => r[k] > v), q),
      lt: (k: string, v: any) => (filters.push(r => r[k] < v), q), in: (k: string, v: unknown[]) => (filters.push(r => v.includes(r[k])), q),
      order: (k: string, o?: { ascending?: boolean }) => (order = [k, o?.ascending ?? true], q), limit: (n: number) => (limit = n, q),
      insert: (row: Row | Row[]) => (action = 'insert', payload = row, q), update: (row: Row) => (action = 'update', payload = row, q), delete: () => (action = 'delete', q),
      single: async () => { const r = result(); return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: 'not one row' } }; },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(ok, bad),
    };
    return q;
  };
  return { from,rpc:async(name:string,args:any)=>{
    if(name!=='save_project_script')return {data:null,error:{message:'unsupported_operation'}};
    const project=(tables.projects??[]).find(p=>p.id===args.p_project&&p.user_id===args.p_user);
    if(!project)return {data:null,error:{message:'not_found'}};
    const current=createHash('sha256').update(project.script).digest('hex');
    if(current!==args.p_expected_hash)return {data:null,error:{message:'version_conflict'}};
    project.script=args.p_script;project.updated_at=new Date().toISOString();
    return {data:{project,script_hash:createHash('sha256').update(project.script).digest('hex')},error:null};
  }} as any;
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
      'seed_composition', 'get_composition', 'save_composition', 'list_references', 'create_upload_url', 'queue_blockout', 'get_job', 'get_blockout', 'make_storyboard', 'get_storyboard',
      'analyze_video', 'save_prompts', 'prepare_generation', 'import_take',
      'get_transcript', 'transcribe_recording', 'fix_transcript', 'save_plan', 'analyze_beats', 'snapshot', 'snapshot_board', 'get_board',
      'list_styles', 'get_style', 'create_style', 'save_style_file', 'list_radar_runs', 'get_radar_run', 'save_radar_ideas', 'review_radar_idea', 'list_plan_items', 'get_plan_item', 'save_outline']);
    assert.equal(tools.some(t => t.name === 'confirm_creator_profile'), false);
    assert.ok(tools.every(t => t.description && t.annotations));
    await client.close();
  });
}

test('a planned Radar topic carries its sources, and its outline is saved for the Planner', async () => {
  const RUN = crypto.randomUUID(), IDEA = crypto.randomUUID(), ITEM = crypto.randomUUID(), OTHER = crypto.randomUUID();
  tables.radar_runs = [{ id: RUN, user_id: ME, raw: {
    videos: [{ title: 'Supreme Court on Gyanesh Kumar: Will He Be Removed?' }, { title: 'Pakistan new submarine' }],
    news: [{ title: 'Supreme court refuses interim suspension of CEC Gyanesh Kumar', url: 'https://newsonair.gov.in/x' }, { title: 'RBI raises repo rate', url: 'https://x.test/rbi' }] } }];
  tables.radar_ideas = [{ id: IDEA, user_id: ME, run_id: RUN, name: 'Supreme Court refuses to suspend CEC Gyanesh Kumar', keywords: ['Gyanesh Kumar Supreme Court'], evidence: [] }];
  tables.radar_updates = []; tables.radar_reviews = []; tables.radar_profiles = [];
  tables.plan_items = [
    { id: ITEM, user_id: ME, title: 'CEC hearing', notes: '', status: 'idea', radar_idea_id: IDEA, outline: null, created_at: '2026-10-08T00:00:00Z' },
    { id: OTHER, user_id: SOMEONE, title: 'Not mine', notes: '', status: 'idea', radar_idea_id: null, outline: null, created_at: '2026-10-08T00:00:00Z' },
  ];
  const client = await connect('modern');
  const list = await call(client, 'list_plan_items');
  assert.deepEqual(list.structuredContent.items.map((i: Row) => [i.id, i.from_trends]), [[ITEM, true]]);
  const got = await call(client, 'get_plan_item', { plan_item_id: ITEM });
  assert.equal(got.structuredContent.idea.name, tables.radar_ideas[0].name);
  assert.deepEqual(got.structuredContent.related.news.map((n: Row) => n.url), ['https://newsonair.gov.in/x']);
  assert.equal(got.structuredContent.related.videos.length, 1);

  const outline = `# Gyanesh Kumar ko kaun hata sakta hai?\n\n## Sections\n\n### 1. Hook (0:00-0:40)\n- The court refused an interim suspension [AIR]\n${'- point\n'.repeat(30)}`;
  assert.equal((await call(client, 'save_outline', { plan_item_id: ITEM, outline: outline.replace(/^## /gm, '') })).isError, true);
  assert.equal((await call(client, 'save_outline', { plan_item_id: OTHER, outline })).isError, true);
  const saved = await call(client, 'save_outline', { plan_item_id: ITEM, outline });
  assert.equal(saved.structuredContent.saved, true);
  assert.equal(tables.plan_items[0].outline, outline.trim());
  assert.equal(tables.plan_items[1].outline, null);
  await client.close();
});

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
  assert.equal(tables.video_jobs.find(j => j.id === queued.structuredContent.job_id)!.input.local, undefined); // queued on the live site, not a dev worker
  await client.close();
});

test('saves refuse stale versions', async () => {
  const client = await connect('modern');
  const project = await call(client, 'get_project', { project_id: MINE });
  const stale = await call(client, 'save_script', { project_id: MINE, script: 'New', expected_script_hash: '0'.repeat(64) });
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
  for (const topic of ['breakdown', 'script', 'composition', 'blockout', 'studio', 'ai-video']) {
    const guide = await call(client, 'get_guide', { topic });
    assert.ok(guide.structuredContent.guide.length > 500, topic); // Claude Code reads structuredContent only
  }
  await client.close();
});

test('ai video: the blockout is read, prompts are checked before saving, a generation is prepared without spending', { timeout: 120_000 }, async () => {
  const client = await connect('modern');
  const { structuredContent: { project } } = await call(client, 'create_project', { name: 'AI film' });
  const dir = projectDir(ME, project.id), job = crypto.randomUUID();
  await mkdir(join(dir, 'blockout', job), { recursive: true });
  await mkdir(join(dir, 'references', 'shot-1'), { recursive: true });
  await writeFile(join(dir, 'references', 'shot-1', 'boy.png'), 'png');
  // A 4 s "blockout" with one hard cut at 2 s.
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x180:d=2', '-f', 'lavfi', '-i', 'color=blue:s=320x180:d=2',
    '-filter_complex', 'concat=n=2:v=1', '-pix_fmt', 'yuv420p', join(dir, 'blockout', job, 'preview.mp4')]);
  const cuts = await call(client, 'analyze_video', { project_id: project.id, path: `blockout/${job}/preview.mp4` });
  assert.equal(cuts.isError, undefined, cuts.content[0].text);
  const { shots } = JSON.parse(cuts.content[0].text.split('\n').at(-1));
  assert.deepEqual(shots.map((s: Row) => s.start), [0, 2]);
  assert.equal(cuts.content.filter((c: Row) => c.type === 'image').length, 1);
  assert.equal((await call(client, 'analyze_video', { project_id: project.id, path: '../../etc/passwd.mp4' })).isError, true);

  const block = (body: string) => `Director's calls: none.\n\n## The whole film\n\`\`\`\n${body}\n\`\`\`\n`;
  const good = `[GOAL]
A boy follows a red balloon through the mela. The idea: wanting is how you get lost.
Duration: 4 seconds.
[REFERENCES]
@Image1 (references/shot-1/boy.png) - The boy: eight, blue jacket. Take him only. Do not take the background.
[FIRST FRAME AND BLOCKING] The boy centre frame.
[CONTINUITY] Exactly one boy.
[STAGES]
STAGE 1 - 0 to 2s - Reach - He reaches up. References: @Image1. - NO CUT
STAGE 2 - 2 to 4s - Call - In his voice, Hindi: {Papa, woh dekho!} - NO CUT
[CAMERA AND OPTICS] 35mm, 54 degrees. [PHYSICS] The balloon bobs. [LIGHTING] Dusk. [AUDIO] NO BGM. [LOOK] No text.`;
  const blockout = `blockout/${job}/preview.mp4`;
  assert.equal((await call(client, 'save_prompts', { project_id: project.id, model: 'seedance-2.5', markdown: block(good), blockout: 'takes/none.mp4' })).isError, true);
  const bad = await call(client, 'save_prompts', { project_id: project.id, model: 'seedance-2.5', blockout,
    markdown: block(good.replace('Do not take', 'Skip').replace('0 to 2s', '0 to 1.5s').replace('NO BGM', '(sitar) NO BGM').replace('shot-1/boy', 'shot-1/girl')) });
  assert.equal(bad.isError, true);
  const problems = bad.structuredContent.problems['The whole film'].join('\n');
  for (const want of [/starts at 2s/, /"Do not"/, /reserved characters \( \)/, /not found in the project: references\/shot-1\/girl.png/]) assert.match(problems, want);
  assert.match(bad.content[0].text, /starts at 2s/); // the reasons are in the text Claude Code shows
  const saved = await call(client, 'save_prompts', { project_id: project.id, model: 'seedance-2.5', markdown: block(good), blockout });
  assert.equal(saved.structuredContent.saved, true, saved.content[0].text);
  const { ai_video } = (await call(client, 'get_project', { project_id: project.id })).structuredContent;
  assert.match(ai_video.prompts, /Papa, woh dekho/);
  assert.equal(ai_video.blockout, blockout);

  const missing = await call(client, 'prepare_generation', { project_id: project.id, block: 'Segment 9', model: 'seedance-2.5', route: 'api' });
  assert.match(missing.content[0].text, /The whole film/);
  const kling = await call(client, 'prepare_generation', { project_id: project.id, block: 'The whole film', model: 'kling', route: 'mcp' });
  assert.equal(kling.isError, true);
  const prepared = await call(client, 'prepare_generation', { project_id: project.id, block: 'The whole film', model: 'seedance-2.5', route: 'api' });
  const gen = prepared.structuredContent;
  assert.equal(gen.duration, 4);
  assert.equal(gen.images[0].tag, '@Image1');
  assert.match(gen.images[0].url, /^https:\/\/app\.test\/mcp-download\//);
  assert.ok(!gen.prompt.includes('(references') && !gen.prompt.includes('Duration:'));
  assert.match(gen.take, /^takes\/the-whole-film-480p-\d+\.mp4$/);
  assert.match(gen.manifest_url, /mcp-download/);
  assert.equal(gen.estimate_usd, 0.82); // 4 s at 480p 16:9 (no breakdown, so the default aspect)
  assert.match(prepared.content[0].text, /HF_KEY/);

  for (const url of ['https://127.0.0.1/take.mp4', 'http://example.com/take.mp4', 'https://[::1]/take.mp4']) {
    const refused = await call(client, 'import_take', { project_id: project.id, url, name: 'take.mp4' });
    assert.equal(refused.isError, true, url);
  }
  await client.close();
});

test('ai video: the shot table and the cost estimate', async () => {
  const { shotsFromCuts, estimateUsd } = await import('./video-prompts.ts');
  const got = shotsFromCuts([5, 9, 9.1, 29.9], 30);
  assert.deepEqual(got.map(s => s.start), [0, 5, 9]);
  assert.equal(got.at(-1)!.end, 30);
  assert.equal(estimateUsd(5, '480p', '16:9'), 1.03);
  assert.equal(estimateUsd(30, '720p', '9:16'), 13.87);
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

test('the beat board: one labelled frame per beat, and the creator notes come back', { timeout: 240_000 }, async () => {
  const client = await connect('modern');
  assert.equal((await call(client, 'get_board', { project_id: MINE })).isError, true);
  const same = await call(client, 'snapshot_board', { project_id: MINE, beats: [{ at: 1, beat: 'a' }, { at: 1.02, beat: 'b' }] });
  assert.match(same.content[0].text, /share a moment/);
  const made = await call(client, 'snapshot_board', { project_id: MINE, beats: [{ at: 3, beat: '2. The ghat' }, { at: 0.5, beat: '1. Balloon' }] });
  assert.equal(made.isError, undefined, made.content[0].text);
  assert.equal(made.content.filter((c: Row) => c.type === 'image').length, 2);
  const board = JSON.parse(await readFile(join(projectDir(ME, MINE), 'board', 'board.json'), 'utf8'));
  assert.deepEqual(board.frames.map((f: Row) => [f.beat, f.file]), [['1. Balloon', 'beat-01.jpg'], ['2. The ghat', 'beat-02.jpg']]);
  assert.match((await call(client, 'get_board', { project_id: MINE })).content[0].text, /not saved notes/);
  // What the Build step's Save does (PUT /api/playground/:id/board/notes).
  board.frames[1].note = 'Make the ghat wider'; board.note = 'Slower overall'; board.notes_at = new Date().toISOString();
  await writeFile(join(projectDir(ME, MINE), 'board', 'board.json'), JSON.stringify(board));
  const notes = await call(client, 'get_board', { project_id: MINE });
  assert.match(notes.content[0].text, /Overall: Slower overall[\s\S]*2\. The ghat \(3s\): Make the ghat wider/);
  assert.equal(notes.content.filter((c: Row) => c.type === 'image').length, 1);
  const project = await call(client, 'get_project', { project_id: MINE });
  assert.equal(project.structuredContent.board, undefined); // a Production project: the board is Studio-only in get_project
  const again = await call(client, 'snapshot_board', { project_id: MINE, beats: [{ at: 1, beat: '1. Balloon' }] });
  assert.match(again.content[0].text, /round 2/);
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
