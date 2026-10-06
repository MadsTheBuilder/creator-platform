import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { MusicNotes, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { api, safeName, uploadFile } from '../../data/app-server';
import { useAppServer, usePolled, useProjectChanges } from '../../data/hooks';
import { updateProject, type Project } from '../../data/projects';
import { clock, transcriptLines, type Word } from '../../data/transcript';
import { active, latestJob, queueJob, type TranscribeJob } from '../../data/video-jobs';
import { ComputerHelper, useDevices } from '../../components/ComputerHelper';
import { Button, Empty, Notice } from '../../components/ui';

type Media = { name: string; bytes: number };
type Reference = { shot: number; name: string };
// A Studio project's references are project-wide: shot 0 (Production's are per shot, 1 and up).
const isVideo = (name: string) => /\.(mp4|mov|webm)$/i.test(name);
const RECORDING = /^recording\.(mp4|m4a)$/;
// Named, not detected: detection called a Hindi narration English and translated it.
const LANGUAGES = [
  { value: 'hi:roman', label: 'Hindi / Hinglish, in Roman letters' },
  { value: 'hi:devanagari', label: 'Hindi, in Devanagari' },
  { value: 'en:roman', label: 'English' },
];
const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

// Studio track, first step: the creator describes the video and adds visual references, then uploads the recording,
// turned into a working copy plus word timings (a 'transcribe' job that
// the helper on their own computer picks up), and the music and sound effects the build uses. Everything lands in
// the project's media/ folder.
export function Direct({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const server = useAppServer();
  const [job, setJob] = useState<TranscribeJob | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [words, setWords] = useState<Word[] | null>(null);
  const [language, setLanguage] = useState(LANGUAGES[0].value);
  const [script, setScript] = useState(project.script);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState(project.direction);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [saving, setSaving] = useState(false);
  // Saved elsewhere (another tab, the creator's Claude): show it, unless there are unsaved edits here.
  const shown = useRef(project.direction);
  useEffect(() => { if (direction === shown.current) setDirection(project.direction); shown.current = project.direction; }, [project.direction]);
  const base = `/api/playground/${project.id}`;

  const loadMedia = () => api<Media[]>(`${base}/media`).then(setMedia, e => setError(e.message));
  const loadJob = () => latestJob<TranscribeJob>('transcribe', { projectId: project.id }).then(setJob, e => setError(e.message));
  useEffect(() => { void loadJob(); }, [project.id]);
  const loadRefs = () => api<Reference[]>(`${base}/references`).then(setRefs, e => setError(e.message));
  useEffect(() => { if (server === 'ready') { void loadMedia(); void loadRefs(); } }, [server, project.id]);
  usePolled(job, setJob, setError);
  const { devices, online, reload } = useDevices(server === 'ready', setError);
  const changes = useProjectChanges(project.id);
  useEffect(() => { if (!changes) return; void loadJob(); if (server === 'ready') { void loadMedia(); void loadRefs(); } }, [changes]);
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
    if (file.size > 1024 * 1048576) { setError('Recordings up to 1 GB fit. Export a 1080p H.264 copy (Final Cut: File > Share > Apple Devices 1080p) and upload that.'); return; }
    setBusy(true);
    try {
      const name = await send(file, 'recording.mp4');
      if (script !== project.script) onSaved(await updateProject(project.id, { script }));
      const [lang, writing] = language.split(':');
      setJob(await queueJob<TranscribeJob>('transcribe', { file: name, language: lang, writing }, project.id));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function uploadSound(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setBusy(true);
    try { for (const file of files) await send(file, 'music.mp3'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); void loadMedia(); }
  }
  async function saveDirection() {
    setSaving(true); setError('');
    try { onSaved(await updateProject(project.id, { direction })); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  async function uploadRefs(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setBusy(true); setError('');
    try {
      for (const file of files) {
        const name = safeName(file.name, 'reference');
        await api(`${base}/references/0/${encodeURIComponent(name)}`, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); void loadRefs(); }
  }
  async function removeRef(name: string) {
    setError('');
    try { await api(`${base}/references/0/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (e) { setError((e as Error).message); }
    void loadRefs();
  }
  async function cancel() {
    setError('');
    try { await api(`${base}/transcribe/cancel`, { method: 'POST' }); } catch (e) { setError((e as Error).message); }
    void loadJob();
  }
  async function remove(name: string) {
    setError('');
    try { await api(`${base}/media/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (e) { setError((e as Error).message); }
    void loadMedia();
  }

  const recording = media.find(m => RECORDING.test(m.name)), sounds = media.filter(m => !RECORDING.test(m.name) && m.name !== job?.input.file);
  const lines = words ? transcriptLines(words) : [];
  const result = job?.status === 'done' && job.output && 'seconds' in job.output ? job.output : null;
  const waiting = job?.status === 'running'
    ? job.output ? 'Transcribed. Making the 1080p working copy…' : 'Transcribing on your computer. About a minute per minute of speech; the first time also downloads the speech model (about 1.6 GB). You can leave this page.'
    : online ? 'Waiting for your computer to pick this up…' : 'Waiting for your computer. Start the helper below, or ask your Claude Code to transcribe it.';
  const mine = refs.filter(r => r.shot === 0);
  return <div className="storyboard">
    <div className="direct-top">
      <section className="glass storyboard-form" aria-label="References">
        <div><h2>References</h2><p className="muted">Images or videos whose look you want.</p></div>
        <div className="shot-refs direct-refs">
          {mine.map(r => <figure key={r.name}>
            {isVideo(r.name) ? <video src={`${base}/file/references/shot-0/${encodeURIComponent(r.name)}`} muted preload="metadata"/> : <img src={`${base}/file/references/shot-0/${encodeURIComponent(r.name)}`} alt={r.name} loading="lazy"/>}
            <button className="ref-remove" aria-label={`Remove ${r.name}`} onClick={() => void removeRef(r.name)}><Trash size={14}/></button>
          </figure>)}
          <label className={`button ref-add ${busy ? 'disabled' : ''}`}><UploadSimple size={16}/>Upload references
            <input className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" disabled={busy} onChange={uploadRefs}/></label>
        </div>
      </section>
      <section className="glass storyboard-form" aria-label="Direction">
        <div><h2>Explain the video you will make</h2><p className="muted">The one idea that carries it, the look (medium, light, texture, one accent colour), the pace, and what must happen when. Paste links to videos whose style you want.</p></div>
        <textarea aria-label="Direction" rows={9} maxLength={4000} value={direction} onChange={e => setDirection(e.target.value)}
          placeholder={'e.g. Light painting in a dark room: one glowing line draws every idea as I say it. Warm orange on black, haze, slow camera drift, hits on every beat.\nhttps://youtube.com/shorts/…'}/>
        <div className="toolbar-actions"><Button className="primary" disabled={saving || direction === project.direction} onClick={saveDirection}>Save</Button></div>
      </section>
    </div>

    <section className="glass storyboard-form" aria-label="Recording">
      <div className="section-toolbar">
        <div><h2>Recording</h2><p className="muted">Your talking-head video, or a voiceover. Up to 1 GB and 30 minutes. It's transcribed word by word on your own computer, and converted to a 1080p working copy.</p></div>
        <label className={`button primary ${busy || active(job) ? 'disabled' : ''}`}><UploadSimple size={16}/>{recording ? 'Replace recording' : 'Upload recording'}
          <input className="sr-only" type="file" accept="video/*,audio/*" disabled={busy || active(job)} onChange={uploadRecording}/></label>
      </div>
      <label className="recording-language">Spoken language<select value={language} onChange={e => setLanguage(e.target.value)}>{LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></label>
      <label>Your script (optional)<textarea rows={4} maxLength={60000} value={script} onChange={e => setScript(e.target.value)}
        placeholder="Paste what you say, if you wrote it down. It's saved before the upload and helps spell names your way, in your writing (Roman or Devanagari)."/></label>
      {progress !== null && <div role="status" className="upload-progress"><progress max={1} value={progress}/> Uploading… {Math.round(progress * 100)}%</div>}
      {active(job) && <Notice><span role="status">{waiting}</span>{!job!.output && <Button onClick={cancel}><X size={16}/>Cancel</Button>}</Notice>}
      {job?.status === 'failed' && <p role="alert">{job.error}</p>}
      {recording && (recording.name.endsWith('.mp4')
        ? <video className="recording-player" controls preload="metadata" src={`${base}/file/media/${recording.name}`}/>
        : <audio controls preload="metadata" src={`${base}/file/media/${recording.name}`}/>)}
      {!recording && !active(job) && progress === null && <Empty title="No recording yet" body="Upload the video you recorded (or a voiceover). Your Claude times every cut, caption and hit to your words."/>}
    </section>

    {result && <section className="glass storyboard-form" aria-label="Transcript">
      <div><h2>Transcript</h2><p className="muted">{clock(result.seconds)} · {result.words} words. Your Claude reads this to time the build.</p></div>
      {job?.input.writing === 'roman' && words?.some(w => /[ऀ-ॿ]/.test(w.text)) && <p className="muted">Parts are in Devanagari. Your Claude converts it to Roman letters before building.</p>}
      {words === null ? <p role="status">Loading the transcript…</p>
        : <ol className="transcript">{lines.map((l, i) => <li key={i}><time>{clock(l.start)}</time><span>{l.text}</span></li>)}</ol>}
    </section>}

    {!result && <ComputerHelper title="Transcribed on your computer" body="Speech to text runs on your own computer through a small helper, never on our servers. Your Claude Code can also do it without the helper."
      setup="The first transcription downloads the speech model (about 1.6 GB, once). On a Mac, also run: brew install whisper-cpp" devices={devices} reload={reload} setError={setError}/>}

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

    {project.beat_plan.trim() && <section className="glass storyboard-form" aria-label="Beat plan">
      <div><h2>Beat plan</h2><p className="muted">Written by your Claude from the transcript and your direction. Approve or change it in your Claude chat; it builds only after you approve.</p></div>
      <p className="storyboard-brief">{project.beat_plan}</p>
    </section>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
