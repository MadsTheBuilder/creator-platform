import { useEffect, useState, type FormEvent } from 'react';
import { usePolled, useProjectChanges } from '../../data/hooks';
import type { Project } from '../../data/projects';
import { active, latestJob, queueJob, type BreakdownJob } from '../../data/video-jobs';
import { totalSeconds } from '../../storyboard/composition';
import { Button, Collapser, Notice } from '../../components/ui';

const FORMATS = ['Let Claude decide', 'Narrated documentary, dark and investigative', 'Explainer, clear and upbeat', 'Short film / drama', 'Ad / commercial', 'Reel / Short, energetic', 'Comedy sketch', 'Music video', 'Corporate / brand film'];
const METHODS = ['Let Claude decide', 'Live action, full crew', 'Run-and-gun, small crew', 'AI-generated video (Higgsfield, Seedance, Veo)', '3D / animation', 'Stock footage + motion graphics'];

// The project's latest shot breakdown (null while loading or when there is none).
export function useBreakdown(projectId: string) {
  const [breakdown, setBreakdown] = useState<BreakdownJob | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setBreakdown(null); latestJob<BreakdownJob>('breakdown', { projectId }).then(setBreakdown, e => setError(e.message)); }, [projectId]);
  const changes = useProjectChanges(projectId);
  useEffect(() => { if (changes) latestJob<BreakdownJob>('breakdown', { projectId }).then(setBreakdown, () => {}); }, [changes]);
  usePolled(breakdown, setBreakdown, setError);
  return { breakdown, setBreakdown, error, setError };
}

export function Shots({ project, onScript, on3d }: { project: Project; onScript: () => void; on3d: () => void }) {
  const { breakdown, setBreakdown, error, setError } = useBreakdown(project.id);
  const [busy, setBusy] = useState(false);
  const board = breakdown?.status === 'done' ? breakdown.output : null;
  // The vision form is the way in; once a breakdown exists it folds away under the result.
  const [formOpen, setFormOpen] = useState<boolean | null>(null);
  const showForm = formOpen ?? !board;

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), pick = (k: string) => String(form.get(k) ?? '');
    const decide = (v: string) => v.startsWith('Let Claude') ? '' : v;
    setBusy(true); setError('');
    try {
      setBreakdown(await queueJob<BreakdownJob>('breakdown', { script: project.script, vision: {
        format: decide(pick('format')), method: decide(pick('method')), aspect: pick('aspect'),
        runtime: Number(pick('runtime')) || undefined, feel: pick('feel').trim(),
      } }, project.id));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const visionForm = (<form className="glass storyboard-form" onSubmit={start}>
      <div className="section-toolbar">
        <div><h2>Vision</h2><p className="muted">{project.script.trim() ? `Breaking down the project script (${project.script.trim().split(/\s+/).length} words).` : 'This project has no script yet.'}</p></div>
        <div className="toolbar-actions">
          <Button type="button" onClick={onScript}>Edit script</Button>
          <Collapser open={showForm} onToggle={() => setFormOpen(!showForm)} label="form"/>
        </div>
      </div>
      <div className="collapse-body" hidden={!showForm}>
      <div className="storyboard-fields">
        <label>Format and tone<select name="format">{FORMATS.map(f => <option key={f}>{f}</option>)}</select></label>
        <label>Production method<select name="method">{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Platform<select name="aspect"><option value="16:9">YouTube, 16:9</option><option value="9:16">Reels / Shorts / TikTok, 9:16</option></select></label>
        <label>Target length (seconds)<input name="runtime" type="number" min={5} max={1800} placeholder="Script's natural length"/></label>
      </div>
      <label>How should it feel?<textarea name="feel" rows={2} maxLength={1000} placeholder="References, mood, what must never be shown…"/></label>
      <Button className="primary" type="submit" disabled={busy || active(breakdown) || !project.script.trim()}>Break down script</Button>
      {error && <p role="alert">{error}</p>}
      </div>
    </form>);

  return <div className="storyboard">
    {!board && visionForm}

    {active(breakdown) && <Notice><span role="status">Breaking down your script into shots. Longer scripts take a few minutes; you can leave this page and come back.</span></Notice>}
    {breakdown?.status === 'failed' && <p role="alert">{breakdown.error}</p>}

    {board && <section className="glass storyboard-result" aria-label="Storyboard">
      <div className="section-toolbar">
        <div><h2>{board.title}</h2><p className="muted">{board.scenes.reduce((n, s) => n + s.shots.length, 0)} shots · {Math.round(totalSeconds(board))} s · {board.aspect}{breakdown?.input.source === 'mcp' && ' · from your AI assistant'}</p></div>
        <Button className="primary" onClick={on3d}>3D visual</Button>
      </div>
      {board.brief && <details><summary>Vision brief</summary><p className="storyboard-brief">{board.brief}</p></details>}
      <div className="table-scroll storyboard-shots"><table>
        <thead><tr><th>#</th><th>Shot</th><th>Framing</th><th>Camera</th><th>Light</th><th>Audio</th><th>Sec</th></tr></thead>
        {(() => { let n = 0; return board.scenes.map((scene, i) => <tbody key={i}>
          <tr><th colSpan={7} scope="rowgroup">{scene.heading}</th></tr>
          {scene.shots.map((shot, j) => <tr key={j}><td>{++n}</td><td>{shot.description}</td><td>{shot.magnification} · {shot.lens}{/^\d+$/.test(shot.lens) ? 'mm' : ''} · {shot.angle}</td><td>{shot.position}<br/><span className="muted">{shot.movement}</span></td><td>{shot.lighting}</td><td>{shot.audio}</td><td>{shot.duration}</td></tr>)}
        </tbody>); })()}
      </table></div>
    </section>}

    {board && visionForm}
  </div>;
}
