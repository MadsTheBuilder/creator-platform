import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'storyboard-'));
const { frameTimes, makeStoryboard, readStoryboard, StoryboardError } = await import('./storyboard.ts');

const shot = (duration: number) => ({ duration, description: 'A shot.', magnification: 'MS', movement: 'Static', lens: '50', angle: 'Eye Level', position: '', lighting: '', notes: '', audio: '' });
const breakdown = { title: 'T', aspect: '16:9', scenes: [{ heading: 'S1', lighting: '', shots: [shot(5), shot(9)] }] };
// Just enough of the Supabase client for latestBreakdown and touchProject: every call chains, every await resolves.
const db = new Proxy({}, { get: (_, key) => key === 'then' ? undefined : () => chain }) as never;
const chain: Record<string, unknown> = new Proxy({}, { get: (_, key) =>
  key === 'then' ? (ok: (v: unknown) => void) => ok({ data: null })
  : key === 'maybeSingle' ? async () => ({ data: { id: 'b1', output: breakdown, input: {}, created_at: '' } })
  : () => chain });

test('frames: 3 per shot, 6 from 9 s, back to back, clear of the cuts', () => {
  const [a, b] = frameTimes([{ no: 1, duration: 5 }, { no: 2, duration: 9 }]);
  assert.deepEqual(a.times, [0.05, 2.5, 4.95]);
  assert.equal(b.start, 5);
  assert.equal(b.times.length, 6);
  assert.equal(b.times[0], 5.05);
  assert.equal(b.times.at(-1), 13.95);
});

test('a storyboard from a reference video that matches the breakdown; a mismatched one is refused', async () => {
  const user = '00000000-0000-0000-0000-000000000001', project = '00000000-0000-0000-0000-000000000002';
  const refs = join(process.env.DATA_DIR!, 'projects', user, project, 'references', 'shot-0');
  mkdirSync(refs, { recursive: true });
  const make = (name: string, seconds: number) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=24:duration=${seconds}`, '-pix_fmt', 'yuv420p', join(refs, name)]);
  make('good.mp4', 14);
  make('short.mp4', 10);

  const board = await makeStoryboard(db, user, project, 'references/shot-0/good.mp4');
  assert.deepEqual(board.shots.map(s => s.frames.length), [3, 6]);
  for (const f of [...board.shots.flatMap(s => s.frames.map(x => x.file)), 'storyboard/overview.jpg'])
    assert.ok(existsSync(join(process.env.DATA_DIR!, 'projects', user, project, f)), f);
  assert.equal((await readStoryboard(user, project))?.video, 'references/shot-0/good.mp4');

  await assert.rejects(makeStoryboard(db, user, project, 'references/shot-0/short.mp4'), (e: Error) => e instanceof StoryboardError && /add up to 14 s/.test(e.message));
  await assert.rejects(makeStoryboard(db, user, project, '../../etc/passwd.mp4'), StoryboardError);
});
