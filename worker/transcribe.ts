// Studio track: an uploaded recording becomes the project's working copy (media/recording.mp4, or .m4a for a
// voiceover with no picture) plus word-level timings in transcript.json, which the creator's Claude times the
// build to and HyperFrames' caption blocks read.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { JobError } from './job-error.ts';
import { local, MB, mediaPath, projectDir, readTranscript } from './project-files.ts';

const run = promisify(execFile);
const HYPERFRAMES = local('./node_modules/hyperframes/bin/hyperframes.mjs');
const MAX_SECONDS = 30 * 60;
const LANGUAGES = new Set(['hi', 'en']);

type Job = { user_id: string; project_id: string; input: { file?: unknown; language?: unknown } };

export async function transcribe(job: Job) {
  const name = String(job.input.file ?? ''), src = mediaPath(job.user_id, job.project_id, name);
  if (!src || !existsSync(src)) throw new JobError('The recording is missing. Please upload it again.');
  const dir = projectDir(job.user_id, job.project_id), media = join(dir, 'media');

  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', src])
    .then(r => JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: { codec_type: string }[] })
    .catch(() => { throw new JobError('That file could not be read as audio or video. Try exporting it as MP4.'); });
  const seconds = Number(probe.format?.duration), types = new Set(probe.streams?.map(s => s.codec_type));
  if (!types.has('audio')) throw new JobError('That recording has no sound to transcribe.');
  if (!(seconds > 0) || seconds > MAX_SECONDS) throw new JobError('Recordings up to 30 minutes fit.');

  // A browser-friendly working copy: phone HEVC doesn't play in Chrome, and renders want a constant frame rate.
  const video = types.has('video'), out = join(media, video ? 'recording.mp4' : 'recording.m4a'), tmp = join(media, `.recording-tmp${video ? '.mp4' : '.m4a'}`);
  const picture = video ? ['-vf', 'scale=w=min(1920\\,iw):h=min(1920\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'] : ['-vn'];
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', src, ...picture, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', tmp], { timeout: 30 * 60_000, maxBuffer: 4 * MB });
  } catch (e) {
    await rm(tmp, { force: true });
    console.error('ffmpeg failed', e);
    throw new JobError('That recording could not be converted. Try exporting it as MP4 (H.264).');
  }
  // One recording per project: a new one replaces the old working copy (and the other kind, if it changed).
  await rm(join(media, video ? 'recording.m4a' : 'recording.mp4'), { force: true });
  await rename(tmp, out);
  if (src !== out) await rm(src, { force: true });

  // Hindi and English mixed: the multilingual small model. Without a language it detects one, which can
  // mislabel Hinglish, so the creator can name it.
  await rm(join(dir, 'transcript.json'), { force: true }); // never leave the old recording's words behind
  const language = LANGUAGES.has(String(job.input.language)) ? ['--language', String(job.input.language)] : [];
  try {
    await run(process.execPath, [HYPERFRAMES, 'transcribe', out, '-d', dir, '--model', 'small', '--engine', 'whisper', ...language],
      { timeout: 60 * 60_000, maxBuffer: 16 * MB, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' } });
  } catch (e) {
    console.error('transcribe failed', e);
    throw new JobError('Transcription failed. Please try again.');
  }
  const words = await readTranscript(job.user_id, job.project_id);
  if (!words) throw new JobError('Transcription finished without any words. Is there speech in the recording?');
  return { file: `media/${video ? 'recording.mp4' : 'recording.m4a'}`, seconds: Math.round(seconds * 10) / 10, words: words.length, video };
}
