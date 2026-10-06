import { useEffect, useRef, useState } from 'react';
import { updateProject, type Project } from '../../data/projects';
import { Button, Empty } from '../../components/ui';

// Studio track: the creator's direction (saved to the project), and the beat plan their own Claude writes
// from it and the transcript over MCP. Nothing is built before the plan exists.
export function Direction({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [text, setText] = useState(project.direction);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Saved elsewhere (another tab, the creator's Claude): show it, unless there are unsaved edits here.
  const shown = useRef(project.direction);
  useEffect(() => { if (text === shown.current) setText(project.direction); shown.current = project.direction; }, [project.direction]);

  async function save() {
    setBusy(true); setError('');
    try { onSaved(await updateProject(project.id, { direction: text })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return <div className="storyboard">
    <section className="glass storyboard-form" aria-label="Direction">
      <h2>Direction</h2>
      <p className="muted">A few lines: the one idea that carries the piece, the look (medium, light, texture, one accent colour), the pace. Paste 1–3 links to videos whose style you want.</p>
      <textarea aria-label="Direction" rows={8} maxLength={4000} value={text} onChange={e => setText(e.target.value)}
        placeholder={'e.g. Light painting in a dark room: one glowing line draws every idea as I say it. Warm orange on black, haze, slow camera drift, hits on every beat.\nhttps://youtube.com/shorts/…'}/>
      <div className="toolbar-actions">
        <Button className="primary" disabled={busy || text === project.direction} onClick={save}>Save direction</Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>

    <section className="glass storyboard-form" aria-label="Beat plan">
      {project.beat_plan.trim()
        ? <><h2>Beat plan</h2><p className="muted">Written by your Claude from the transcript and this direction. Approve or change it in your Claude chat; it builds only after you approve.</p><p className="storyboard-brief">{project.beat_plan}</p></>
        : <Empty title="No beat plan yet" body={`Save your direction, then ask your Claude (with the Content Engine connector): "Plan my Studio video for ${project.name}". The plan shows here.`}/>}
    </section>
  </div>;
}
