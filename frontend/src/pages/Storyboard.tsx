import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import '@hyperframes/player';
import { supabase } from '../data/supabase';
import { active, getJob, latestJob, queueJob, renderUrl, type BreakdownJob, type RenderJob } from '../data/video-jobs';
import { buildComposition, totalSeconds, type Storyboard as Board } from '../storyboard/composition';
import { Button, Empty, Notice } from '../components/ui';

declare module 'react' {
  namespace JSX { interface IntrinsicElements { 'hyperframes-player': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { srcdoc?: string; controls?: boolean } } }
}

const FORMATS = ['Let Claude decide', 'Narrated documentary, dark and investigative', 'Explainer, clear and upbeat', 'Short film / drama', 'Ad / commercial', 'Reel / Short, energetic', 'Comedy sketch', 'Music video', 'Corporate / brand film'];
const METHODS = ['Let Claude decide', 'Live action, full crew', 'Run-and-gun, small crew', 'AI-generated video (Higgsfield, Seedance, Veo)', '3D / animation', 'Stock footage + motion graphics'];
const POLL_MS = 4000;

// Poll a job until the worker finishes it.
function usePolled<T extends BreakdownJob | RenderJob>(job: T | null, setJob: (job: T) => void, setError: (e: string) => void) {
  useEffect(() => {
    if (!active(job)) return;
    const timer = setInterval(() => { getJob<T>(job!.id).then(setJob, e => setError(e.message)); }, POLL_MS);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
}

export function Storyboard({ onConnections }: { onConnections: () => void }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownJob | null>(null);
  const [render, setRender] = useState<RenderJob | null>(null);
  const [video, setVideo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) latestJob<BreakdownJob>('breakdown').then(setBreakdown, e => setError(e.message)); }, [session?.user.id]);
  useEffect(() => { setRender(null); setVideo(''); if (breakdown?.status === 'done') latestJob<RenderJob>('render', breakdown.id).then(setRender, e => setError(e.message)); }, [breakdown?.id, breakdown?.status]);
  useEffect(() => { if (render?.status === 'done' && render.output) renderUrl(render.output.path, `${breakdown?.output?.title || 'storyboard'}.mp4`).then(setVideo, e => setError(e.message)); }, [render?.id, render?.status]);
  usePolled(breakdown, setBreakdown, setError);
  usePolled(render, setRender, setError);

  const board = breakdown?.status === 'done' ? breakdown.output : null;
  const html = useMemo(() => board ? buildComposition(board) : '', [board]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), pick = (k: string) => String(form.get(k) ?? '');
    const decide = (v: string) => v.startsWith('Let Claude') ? '' : v;
    setBusy(true); setError('');
    try {
      setBreakdown(await queueJob<BreakdownJob>('breakdown', { script: pick('script'), vision: {
        format: decide(pick('format')), method: decide(pick('method')), aspect: pick('aspect'),
        runtime: Number(pick('runtime')) || undefined, feel: pick('feel').trim(),
      } }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function exportVideo() {
    if (!breakdown || !board) return;
    setBusy(true); setError('');
    try { setRender(await queueJob<RenderJob>('render', { breakdown_id: breakdown.id, storyboard: board })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (session === undefined) return <p role="status">Checking your account…</p>;
  if (!session) return <Empty title="Sign in to build storyboards" body="Storyboards and renders are saved to your account."><Button className="primary" onClick={onConnections}>Go to sign-in</Button></Empty>;

  return <div className="storyboard">
    <form className="glass storyboard-form" onSubmit={start}>
      <h2>Script</h2>
      <textarea name="script" required rows={10} maxLength={60000} placeholder="Paste your script: VO, dialogue, scene notes…" defaultValue={breakdown?.input.script ?? ''}/>
      <div className="storyboard-fields">
        <label>Format and tone<select name="format">{FORMATS.map(f => <option key={f}>{f}</option>)}</select></label>
        <label>Production method<select name="method">{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Platform<select name="aspect"><option value="16:9">YouTube, 16:9</option><option value="9:16">Reels / Shorts / TikTok, 9:16</option></select></label>
        <label>Target length (seconds)<input name="runtime" type="number" min={5} max={1800} placeholder="Script's natural length"/></label>
      </div>
      <label>How should it feel?<textarea name="feel" rows={2} maxLength={1000} placeholder="References, mood, what must never be shown…"/></label>
      <Button className="primary" type="submit" disabled={busy || active(breakdown)}>Break down script</Button>
      {error && <p role="alert">{error}</p>}
    </form>

    {active(breakdown) && <Notice><span role="status">Breaking down your script into shots. Longer scripts take a few minutes; you can leave this page and come back.</span></Notice>}
    {breakdown?.status === 'failed' && <p role="alert">{breakdown.error}</p>}

    {board && <section className="glass storyboard-result" aria-label="Storyboard">
      <div className="section-toolbar">
        <div><h2>{board.title}</h2><p className="muted">{board.scenes.reduce((n, s) => n + s.shots.length, 0)} shots · {Math.round(totalSeconds(board))} s · {board.aspect}</p></div>
        <div className="toolbar-actions">
          {video ? <a className="button primary" href={video}>Download MP4</a>
            : <Button className="primary" disabled={busy || active(render)} onClick={exportVideo}>{active(render) ? 'Rendering…' : 'Export MP4'}</Button>}
        </div>
      </div>
      {active(render) && <p className="muted" role="status">Rendering the animatic. This takes about twice the video's length.</p>}
      {render?.status === 'failed' && <p role="alert">{render.error}</p>}
      <hyperframes-player className={`storyboard-player ${board.aspect === '9:16' ? 'portrait' : ''}`} srcdoc={html} controls/>
      {board.brief && <details><summary>Vision brief</summary><p className="storyboard-brief">{board.brief}</p></details>}
      <div className="table-scroll storyboard-shots"><table>
        <thead><tr><th>#</th><th>Shot</th><th>Framing</th><th>Camera</th><th>Light</th><th>Audio</th><th>Sec</th></tr></thead>
        {(() => { let n = 0; return board.scenes.map((scene, i) => <tbody key={i}>
          <tr><th colSpan={7} scope="rowgroup">{scene.heading}</th></tr>
          {scene.shots.map((shot, j) => <tr key={j}><td>{++n}</td><td>{shot.description}</td><td>{shot.magnification} · {shot.lens}{/^\d+$/.test(shot.lens) ? 'mm' : ''} · {shot.angle}</td><td>{shot.position}<br/><span className="muted">{shot.movement}</span></td><td>{shot.lighting}</td><td>{shot.audio}</td><td>{shot.duration}</td></tr>)}
        </tbody>); })()}
      </table></div>
    </section>}
  </div>;
}
