import { useEffect, useState, type ChangeEvent } from 'react';
import { MusicNotes, Trash, UploadSimple } from '@phosphor-icons/react';
import { api, safeName, uploadFile } from '../../data/app-server';
import { useAppServer, usePolled, useProjectChanges } from '../../data/hooks';
import type { Project } from '../../data/projects';
import { clock, transcriptLines, type Word } from '../../data/transcript';
import { active, latestJob, queueJob, type TranscribeJob } from '../../data/video-jobs';
import { Button, Empty, Notice } from '../../components/ui';

type Media = { name: string; bytes: number };
const RECORDING = /^recording\.(mp4|m4a)$/;
const LANGUAGES = [{ value: '', label: 'Hindi and English (detect)' }, { value: 'hi', label: 'Mostly Hindi' }, { value: 'en', label: 'Mostly English' }];
const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

// Studio track: the creator's recording, turned into a working copy plus word timings (a 'transcribe' job),
// and the music and sound effects the build uses. Everything lands in the project's media/ folder.
export function Recording({ project }: { project: Project }) {
  const server = useAppServer();
  const [job, setJob] = useState<TranscribeJob | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [words, setWords] = useState<Word[] | null>(null);
  const [language, setLanguage] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/api/playground/${project.id}`;

  const loadMedia = () => api<Media[]>(`${base}/media`).then(setMedia, e => setError(e.message));
  const loadJob = () => latestJob<TranscribeJob>('transcribe', { projectId: project.id }).then(setJob, e => setError(e.message));
  useEffect(() => { void loadJob(); }, [project.id]);
  useEffect(() => { if (server === 'ready') void loadMedia(); }, [server, project.id]);
  usePolled(job, setJob, setError);
  const changes = useProjectChanges(project.id);
  useEffect(() => { if (!changes) return; void loadJob(); if (server === 'ready') void loadMedia(); }, [changes]);
  // The transcript belongs to the latest finished job; reload it whenever that job changes.
  useEffect(() => {
    setWords(null);
    if (server !== 'ready' || job?.status !== 'done') return;
    api<Word[]>(`${base}/file/transcript.json`).then(setWords, () => setWords([]));
    void loadMedia();
  }, [server, job?.id, job?.status]);

  if (server !== 'ready') return server === 'connecting' ? <p role="status">Connecting…</p> : <p role="alert">{server}</p>;

  async function send(file: File, fallback: string) {
    const name = safeName(file.name, fallback);
    setProgress(0); setError('');
    try { await uploadFile(`${base}/media/${encodeURIComponent(name)}`, file, setProgress); return name; }
    finally { setProgress(null); }
  }
  async function uploadRecording(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1048576) { setError('Recordings up to 1 GB fit. Export a 1080p copy and try again.'); return; }
    setBusy(true);
    try {
      const name = await send(file, 'recording.mp4');
      setJob(await queueJob<TranscribeJob>('transcribe', { file: name, ...(language ? { language } : {}) }, project.id));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function uploadSound(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setBusy(true);
    try { for (const file of files) await send(file, 'music.mp3'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); void loadMedia(); }
  }
  async function remove(name: string) {
    setError('');
    try { await api(`${base}/media/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (e) { setError((e as Error).message); }
    void loadMedia();
  }

  const recording = media.find(m => RECORDING.test(m.name)), sounds = media.filter(m => !RECORDING.test(m.name) && m.name !== job?.input.file);
  const lines = words ? transcriptLines(words) : [];
  return <div className="storyboard">
    <section className="glass storyboard-form" aria-label="Recording">
      <div className="section-toolbar">
        <div><h2>Recording</h2><p className="muted">Your talking-head video, or a voiceover. Up to 1 GB and 30 minutes; it's converted to a 1080p working copy and transcribed word by word.</p></div>
        <label className={`button primary ${busy || active(job) ? 'disabled' : ''}`}><UploadSimple size={16}/>{recording ? 'Replace recording' : 'Upload recording'}
          <input className="sr-only" type="file" accept="video/*,audio/*" disabled={busy || active(job)} onChange={uploadRecording}/></label>
      </div>
      <label className="recording-language">Spoken language<select value={language} onChange={e => setLanguage(e.target.value)}>{LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></label>
      {progress !== null && <div role="status" className="upload-progress"><progress max={1} value={progress}/> Uploading… {Math.round(progress * 100)}%</div>}
      {active(job) && <Notice><span role="status">Converting and transcribing your recording. About a minute per minute of speech; you can leave this page.</span></Notice>}
      {job?.status === 'failed' && <p role="alert">{job.error}</p>}
      {recording && (recording.name.endsWith('.mp4')
        ? <video className="recording-player" controls preload="metadata" src={`${base}/file/media/${recording.name}`}/>
        : <audio controls preload="metadata" src={`${base}/file/media/${recording.name}`}/>)}
      {!recording && !active(job) && progress === null && <Empty title="No recording yet" body="Upload the video you recorded (or a voiceover). Your Claude times every cut, caption and hit to your words."/>}
    </section>

    {job?.status === 'done' && job.output && <section className="glass storyboard-form" aria-label="Transcript">
      <div><h2>Transcript</h2><p className="muted">{clock(job.output.seconds)} · {job.output.words} words. Your Claude reads this to time the build.</p></div>
      {words === null ? <p role="status">Loading the transcript…</p>
        : <ol className="transcript">{lines.map((l, i) => <li key={i}><time>{clock(l.start)}</time><span>{l.text}</span></li>)}</ol>}
    </section>}

    <section className="glass storyboard-form" aria-label="Music and sound">
      <div className="section-toolbar">
        <div><h2>Music and sound</h2><p className="muted">Optional. Music you have the rights to, and sound effects. Your Claude maps the music's beats and cuts on them.</p></div>
        <label className={`button ${busy ? 'disabled' : ''}`}><MusicNotes size={16}/>Add audio<input className="sr-only" type="file" accept="audio/*" multiple disabled={busy} onChange={uploadSound}/></label>
      </div>
      {sounds.length > 0 && <ul className="media-list">{sounds.map(m => <li key={m.name}>
        <span>{m.name} <small className="muted">{mb(m.bytes)}</small></span>
        <Button aria-label={`Remove ${m.name}`} onClick={() => void remove(m.name)}><Trash size={16}/></Button>
      </li>)}</ul>}
    </section>
    {error && <p role="alert">{error}</p>}
  </div>;
}
