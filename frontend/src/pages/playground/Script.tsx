import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from 'react';
import { UploadSimple } from '@phosphor-icons/react';
import { usePolled } from '../../data/hooks';
import { updateProject, type Project } from '../../data/projects';
import { active, latestJob, queueJob, type ScriptJob } from '../../data/video-jobs';
import { Button, Notice } from '../../components/ui';

const TONES = ['Let Claude decide', 'Conversational and warm', 'Punchy and energetic', 'Calm and explanatory', 'Dark and investigative', 'Funny'];

export function Script({ project, onSaved, onShots }: { project: Project; onSaved: (p: Project) => void; onShots: () => void }) {
  const [text, setText] = useState(project.script);
  const [job, setJob] = useState<ScriptJob | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = text !== project.script;

  useEffect(() => { setText(project.script); latestJob<ScriptJob>('script', { projectId: project.id }).then(setJob, e => setError(e.message)); }, [project.id]);
  usePolled(job, setJob, setError);
  // The script changed elsewhere (e.g. saved by the creator's Claude): show it, unless there are unsaved edits here.
  const shown = useRef(project.script);
  useEffect(() => { if (text === shown.current) setText(project.script); shown.current = project.script; }, [project.script]);

  async function save(script = text) {
    setBusy(true); setError('');
    try { onSaved(await updateProject(project.id, { script })); setText(script); return true; }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }

  // Pasting a whole script replaces the one in the box (pasting into the middle of the old script mixes the two).
  // Short pastes and pastes over a selection behave normally. Undo puts the previous text back.
  const [replaced, setReplaced] = useState<string | null>(null);
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData('text'), box = event.currentTarget;
    const wholeSelected = box.selectionStart === 0 && box.selectionEnd === text.length;
    if (pasted.length < 300 || !text.trim() || wholeSelected) return;
    event.preventDefault();
    setReplaced(text);
    setText(pasted.slice(0, 60000));
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 500_000) { setError('That file is too large. Scripts up to about 60,000 characters fit.'); return; }
    setReplaced(text.trim() ? text : null);
    setText((await file.text()).slice(0, 60000));
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), pick = (k: string) => String(form.get(k) ?? '');
    setBusy(true); setError('');
    try {
      setJob(await queueJob<ScriptJob>('script', {
        idea: pick('idea').trim(), platform: pick('platform'), length: Number(pick('length')) || 60,
        tone: pick('tone').startsWith('Let Claude') ? '' : pick('tone'),
      }, project.id));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const draft = job?.status === 'done' ? job.output : null;

  return <div className="storyboard">
    <section className="glass storyboard-form" aria-label="Script">
      <div className="section-toolbar">
        <h2>Script</h2>
        <label className="button"><UploadSimple size={16}/>Upload .txt / .md<input className="sr-only" type="file" accept=".txt,.md,.fountain,text/plain,text/markdown" onChange={upload}/></label>
      </div>
      <textarea aria-label="Script" rows={16} maxLength={60000} placeholder="Paste your script: VO, dialogue, scene notes… or generate one below." value={text} onPaste={paste} onChange={e => { setText(e.target.value); setReplaced(null); }}/>
      {replaced !== null && <Notice><span role="status">Replaced the previous script with what you pasted.</span> <button className="link-button" onClick={() => { setText(replaced); setReplaced(null); }}>Undo</button></Notice>}
      <div className="toolbar-actions">
        <Button className="primary" disabled={busy || !dirty} onClick={() => save()}>Save script</Button>
        <Button disabled={busy || !text.trim()} onClick={async () => { if (!dirty || await save()) onShots(); }}>Next: shot breakdown</Button>
      </div>
    </section>

    <form className="glass storyboard-form" onSubmit={generate}>
      <h2>Generate a script</h2>
      <label>What's the video about?<textarea name="idea" required rows={3} maxLength={2000} placeholder="The idea, the angle, anything that must be said…"/></label>
      <div className="storyboard-fields">
        <label>Platform<select name="platform"><option>YouTube (long-form)</option><option>YouTube Shorts</option><option>Instagram Reels</option><option>TikTok</option></select></label>
        <label>Length (seconds)<input name="length" type="number" min={15} max={1800} defaultValue={60}/></label>
        <label>Tone<select name="tone">{TONES.map(t => <option key={t}>{t}</option>)}</select></label>
      </div>
      <Button className="primary" type="submit" disabled={busy || active(job)}>Generate script</Button>
      {error && <p role="alert">{error}</p>}
    </form>

    {active(job) && <Notice><span role="status">Writing your script. This takes a minute or two.</span></Notice>}
    {job?.status === 'failed' && <p role="alert">{job.error}</p>}
    {draft && <section className="glass storyboard-form" aria-label="Generated script">
      <div className="section-toolbar">
        <h2>{draft.title}</h2>
        <Button className="primary" disabled={busy} onClick={() => save(draft.script)}>Use this script</Button>
      </div>
      <p className="storyboard-brief">{draft.script}</p>
    </section>}
  </div>;
}
