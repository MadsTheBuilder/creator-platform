// Studio track: an uploaded recording becomes the project's working copy (media/recording.mp4, or .m4a for a
// voiceover with no picture) plus word-level timings in transcript.json, which the creator's Claude times the
// build to and HyperFrames' caption blocks read.
// Speech to text runs on the creator's own computer (bridge/transcribe.py: the paired helper, or their Claude
// Code), never here: this side serves the speech as 16 kHz audio, then imports whisper.cpp's JSON and makes the
// working copy with ffmpeg.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JobError } from './job-error.ts';
import { local, MB, mediaPath, projectDir, readTranscript } from './project-files.ts';

const run = promisify(execFile);
const HYPERFRAMES = local('./node_modules/hyperframes/bin/hyperframes.mjs');
const MAX_SECONDS = 30 * 60;
export type TranscribeJob = { id: string; user_id: string; project_id: string; input: { file?: unknown; language?: unknown; writing?: unknown } };

// Keys for one job, handed to the creator's Claude Code by transcribe_recording (the helper uses its device key).
// ponytail: in memory, so a restart drops them; the job then fails and the creator asks again.
export const tickets = new Map<string, { user: string; job: string; until: number }>();
export function ticketFor(user: string, job: string) {
  const key = randomBytes(24).toString('base64url');
  tickets.set(key, { user, job, until: Date.now() + 6 * 60 * 60_000 });
  return key;
}

export const whisperJson = (user: string, project: string) => join(projectDir(user, project), '.whisper.json');
const source = (job: TranscribeJob) => mediaPath(job.user_id, job.project_id, String(job.input.file ?? ''));

// Length and kind of the uploaded file; throws a message the creator can act on.
export async function probe(job: TranscribeJob) {
  const src = source(job);
  if (!src || !existsSync(src)) throw new JobError('The recording is missing. Please upload it again.');
  const info = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', src])
    .then(r => JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: { codec_type: string }[] })
    .catch(() => { throw new JobError('That file could not be read as audio or video. Try exporting it as MP4.'); });
  const seconds = Number(info.format?.duration), types = new Set(info.streams?.map(s => s.codec_type));
  if (!types.has('audio')) throw new JobError('That recording has no sound to transcribe.');
  if (!(seconds > 0) || seconds > MAX_SECONDS) throw new JobError('Recordings up to 30 minutes fit.');
  return { src, seconds, video: types.has('video') };
}

// What the computer doing the transcription needs besides the audio. The creator names the language: detection
// called a Hindi narration English and translated it. The prompt (their script, if they wrote one) spells
// names their way. Whisper often writes Hindi in Devanagari whatever the prompt; the creator's Claude converts it.
export async function settings(db: SupabaseClient, job: TranscribeJob) {
  const english = job.input.language === 'en';
  const { data: project } = await db.from('projects').select('script').eq('id', job.project_id).maybeSingle();
  // Whisper keeps at most ~224 prompt tokens; Devanagari spends several per character.
  const script = String(project?.script ?? '').replace(/\s+/g, ' ').trim();
  const prompt = script.slice(0, /[ऀ-ॿ]/.test(script) ? 200 : 500);
  return { language: english ? 'en' : 'hi', prompt };
}

// The speech as 16 kHz mono WAV (whisper.cpp's input), streamed straight out of ffmpeg: ~2 MB a minute.
export function speech(src: string) {
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', src, '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  return Readable.toWeb(ff.stdout) as ReadableStream;
}

// After the creator's computer uploaded .whisper.json: import the words, then make the working copy.
export async function finish(job: TranscribeJob) {
  const { src, seconds, video } = await probe(job);
  const dir = projectDir(job.user_id, job.project_id), media = join(dir, 'media'), raw = whisperJson(job.user_id, job.project_id);
  // Imported beside the project, so a failed conversion never pairs new words with the old recording.
  const words = await mkdtemp(join(dir, '.transcript-'));
  try {
    try {
      // HyperFrames turns whisper.cpp's output into its own transcript.json (words with start/end).
      await run(process.execPath, [HYPERFRAMES, 'transcribe', raw, '-d', words], { timeout: 120_000, maxBuffer: 16 * MB, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' } });
    } catch (e) {
      console.error('transcript import failed', e);
      throw new JobError('Transcription finished without any words. Is there speech in the recording?');
    }

    // A browser-friendly working copy: phone HEVC doesn't play in Chrome, and renders want a constant frame rate.
    const out = join(media, video ? 'recording.mp4' : 'recording.m4a'), tmp = join(media, `.recording-tmp${video ? '.mp4' : '.m4a'}`);
    const picture = video ? ['-vf', 'scale=w=min(1920\\,iw):h=min(1920\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'] : ['-vn'];
    try {
      await run('ffmpeg', ['-v', 'error', '-y', '-i', src, ...picture, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', tmp], { timeout: 60 * 60_000, maxBuffer: 4 * MB });
    } catch (e) {
      await rm(tmp, { force: true });
      console.error('ffmpeg failed', e);
      throw new JobError('That recording could not be converted. Try exporting it as MP4 (H.264).');
    }
    // One recording per project: a new one replaces the old working copy (and the other kind, if it changed).
    await rm(join(media, video ? 'recording.m4a' : 'recording.mp4'), { force: true });
    await rename(tmp, out);
    if (src !== out) await rm(src, { force: true });
    await rename(join(words, 'transcript.json'), join(dir, 'transcript.json'));
  } finally {
    await rm(words, { recursive: true, force: true });
    await rm(raw, { force: true });
  }
  const count = (await readTranscript(job.user_id, job.project_id))?.length ?? 0;
  return { file: `media/${video ? 'recording.mp4' : 'recording.m4a'}`, seconds: Math.round(seconds * 10) / 10, words: count, video };
}
