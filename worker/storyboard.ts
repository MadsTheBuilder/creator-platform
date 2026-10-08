// Production track: the storyboard, frames pulled from a blockout video at each shot's start, middle and end
// (six frames for shots of 9 s or more), laid out by the Storyboard step with the breakdown's own text.
// Ported from tarun-mirzapur/red balloon 3d story board/make_board.py. Shared by server.ts and mcp.ts.
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasRoom, latestBreakdown, listReferences, MB, projectDir, touchProject, UUID } from './project-files.ts';

const run = promisify(execFile);
const EDGE = 0.05; // first and last frame sit this far inside the shot, clear of the cut

export class StoryboardError extends Error {}
export type BoardShot = { no: number; start: number; duration: number; frames: { file: string; at: number }[] };
export type StoryboardFile = { made_at: string; video: string; breakdown_id: string; seconds: number; shots: BoardShot[] };

// When each frame is taken, in seconds of the video: shots back to back from 0, 3 frames (6 from 9 s) evenly from start to end.
export function frameTimes(shots: { no: number; duration: number }[]) {
  let t = 0;
  return shots.map(({ no, duration }) => {
    const n = duration >= 9 ? 6 : 3, start = t;
    t += duration;
    return { no, start, duration, times: Array.from({ length: n }, (_, k) => +(start + EDGE + (duration - 2 * EDGE) * k / (n - 1)).toFixed(2)) };
  });
}

// The videos a storyboard can be made from: finished blockout previews (newest first), then reference videos.
export async function storyboardVideos(db: SupabaseClient, user: string, project: string) {
  const { data } = await db.from('video_jobs').select('id,output,created_at').eq('project_id', project).eq('user_id', user)
    .eq('kind', 'blockout').eq('status', 'done').order('created_at', { ascending: false }).limit(20);
  const blockouts = (data ?? []).filter(j => (j.output?.files ?? []).includes('preview.mp4')).map(j => `blockout/${j.id}/preview.mp4`);
  const refs = (await listReferences(user, project)).filter(r => /\.(mp4|mov|webm)$/i.test(r.name)).map(r => `references/shot-${r.shot}/${r.name}`);
  return [...blockouts, ...refs];
}

export const readStoryboard = (user: string, project: string): Promise<StoryboardFile | null> =>
  readFile(join(projectDir(user, project), 'storyboard', 'storyboard.json'), 'utf8').then(JSON.parse).catch(() => null);

export async function makeStoryboard(db: SupabaseClient, user: string, project: string, video: string): Promise<StoryboardFile> {
  const blockout = video.match(/^blockout\/([0-9a-f-]{36})\/preview\.mp4$/)?.[1];
  if (!(blockout && UUID.test(blockout)) && !/^references\/shot-\d+\/[\w][\w .()-]*\.(mp4|mov|webm)$/i.test(video))
    throw new StoryboardError('Make it from a blockout preview (blockout/<job_id>/preview.mp4) or a reference video (references/shot-N/<name>.mp4).');
  const dir = projectDir(user, project), src = resolve(dir, video);
  if (!src.startsWith(dir + sep) || !(await stat(src).catch(() => null))?.isFile()) throw new StoryboardError(`There is no video at ${video}.`);

  const latest = await latestBreakdown(db, user, project);
  if (!latest) throw new StoryboardError('There is no shot breakdown yet. A storyboard is laid out from it.');
  const all = latest.storyboard.scenes.flatMap(s => s.shots).map((s, i) => ({ no: i + 1, duration: s.duration }));
  // A blockout covers the shots it was asked for, in order; a reference video is taken to be the whole film.
  let shots = all;
  if (blockout) {
    const { data: job } = await db.from('video_jobs').select('input').eq('id', blockout).eq('project_id', project).eq('user_id', user).eq('kind', 'blockout').maybeSingle();
    const wanted: number[] = Array.isArray(job?.input?.shots) ? job.input.shots : [];
    shots = all.filter(s => wanted.includes(s.no));
    if (!shots.length) throw new StoryboardError('That blockout\'s shots are no longer in the breakdown. Build the blockout again.');
  }
  const expected = shots.reduce((n, s) => n + s.duration, 0);
  const seconds = Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).catch(() => ({ stdout: '' }))).stdout);
  if (!(seconds > 0)) throw new StoryboardError(`${video} is not a readable video.`);
  if (Math.abs(seconds - expected) > 1.5)
    throw new StoryboardError(`${video} runs ${seconds.toFixed(1)} s, but shots ${shots[0].no} to ${shots.at(-1)!.no} of the breakdown add up to ${expected} s. Use a video cut to the breakdown, or build the blockout again.`);
  if (!await hasRoom(50 * MB)) throw new StoryboardError('The server is out of space right now. Try again later.');

  const plan = frameTimes(shots);
  const out = join(dir, 'storyboard'), part = `${out}.part`;
  await rm(part, { recursive: true, force: true });
  await mkdir(part, { recursive: true });
  const grab = (at: number, file: string, width: number) => run('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.min(at, seconds - 0.04)), '-i', src,
    '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '3', join(part, file)], { timeout: 60_000 });
  const tasks: (() => Promise<unknown>)[] = [];
  const board: BoardShot[] = plan.map(p => ({ no: p.no, start: p.start, duration: p.duration, frames: p.times.map((at, k) => {
    const file = `shot-${String(p.no).padStart(2, '0')}-${k + 1}.jpg`;
    tasks.push(() => grab(at, file, 960));
    return { file: `storyboard/${file}`, at };
  }) }));
  // The overview: every shot's middle frame, five across (what get_storyboard shows the creator's Claude).
  plan.forEach((p, i) => tasks.push(() => grab(p.start + p.duration / 2, `.ov-${String(i + 1).padStart(3, '0')}.jpg`, 364)));
  try {
    for (let i = 0; i < tasks.length; i += 4) await Promise.all(tasks.slice(i, i + 4).map(t => t()));
    await run('ffmpeg', ['-v', 'error', '-y', '-i', join(part, '.ov-%03d.jpg'), '-vf', `tile=5x${Math.ceil(plan.length / 5)}:padding=8:color=white`,
      '-frames:v', '1', '-q:v', '3', join(part, 'overview.jpg')], { timeout: 60_000 });
  } catch (e) {
    await rm(part, { recursive: true, force: true });
    console.error('storyboard frames failed', e);
    throw new StoryboardError('Frames could not be taken from that video.');
  }
  for (let i = 1; i <= plan.length; i++) await rm(join(part, `.ov-${String(i).padStart(3, '0')}.jpg`), { force: true });
  const file: StoryboardFile = { made_at: new Date().toISOString(), video, breakdown_id: latest.id, seconds: +seconds.toFixed(2), shots: board };
  await writeFile(join(part, 'storyboard.json'), JSON.stringify(file, null, 1));
  await rm(out, { recursive: true, force: true });
  await rename(part, out);
  await touchProject(db, project);
  return file;
}
