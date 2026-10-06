import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, FolderSimple, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useProjectChanges, useSession } from '../data/hooks';
import { createProject, deleteProject, getProject, listProjects, updateProject, type Project } from '../data/projects';
import { Button, Empty } from '../components/ui';
import { Script } from './playground/Script';
import { Shots } from './playground/Shots';
import { Visual3D } from './playground/Visual3D';
import { Edit } from './playground/Edit';

export type Step = 'script' | 'shots' | '3d' | 'edit';
export const STEPS: { step: Step; label: string; blurb: string }[] = [
  { step: 'script', label: 'Script', blurb: 'Write, upload or generate the script.' },
  { step: 'shots', label: 'Shot breakdown', blurb: 'Every shot with framing, lens, camera, light and timing, previewed as an animatic.' },
  { step: '3d', label: '3D visual', blurb: 'Reference images and videos per shot, and Blender blockouts built on your PC.' },
  { step: 'edit', label: 'Video edit', blurb: 'The full HyperFrames editor: timeline, keyframes, audio, blocks and render.' },
];

type Dialog = { mode: 'create' } | { mode: 'rename' | 'delete'; project: Project } | null;

export function Playground({ projectId, step, onOpen, onConnections }: { projectId?: string; step: Step; onOpen: (id?: string, step?: Step) => void; onConnections: () => void }) {
  const session = useSession();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => { if (session && !projectId) listProjects().then(setProjects, e => setError(e.message)); }, [session?.user.id, projectId]);
  useEffect(() => { setProject(null); if (session && projectId) getProject(projectId).then(setProject, e => setError(e.message)); }, [session?.user.id, projectId]);
  const changes = useProjectChanges(projectId);
  useEffect(() => { if (changes && session && projectId) getProject(projectId).then(setProject, () => {}); }, [changes]);
  useEffect(() => { if (dialog) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [dialog]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    setBusy(true); setError('');
    try {
      if (dialog.mode === 'create') { const p = await createProject(name); setDialog(null); onOpen(p.id, 'script'); return; }
      if (dialog.mode === 'rename') { const p = await updateProject(dialog.project.id, { name }); setProjects(ps => ps?.map(x => x.id === p.id ? p : x) ?? null); setProject(x => x && p.id === x.id ? p : x); }
      else { await deleteProject(dialog.project.id); setProjects(ps => ps?.filter(x => x.id !== dialog.project.id) ?? null); if (projectId) onOpen(); }
      setDialog(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (session === undefined) return <p role="status">Checking your account…</p>;
  if (!session) return <Empty title="Sign in to use the Playground" body="Projects, scripts, storyboards and edits are saved to your account."><Button className="primary" onClick={onConnections}>Go to sign-in</Button></Empty>;

  const current = STEPS.find(s => s.step === step)!;
  const nameDialog = <dialog ref={dialogRef} className="glass project-dialog" onClose={() => setDialog(null)}>
    {dialog && <form onSubmit={submit}>
      {dialog.mode === 'delete'
        ? <><h2>Delete “{dialog.project.name}”?</h2><p className="muted">Its script, storyboards and edits are removed for good.</p></>
        : <><h2>{dialog.mode === 'create' ? 'Name your project' : 'Rename project'}</h2>
          <label>Project name<input name="name" required maxLength={80} autoFocus defaultValue={dialog.mode === 'rename' ? dialog.project.name : ''} placeholder="e.g. Red balloon, episode 2"/></label></>}
      {error && <p role="alert">{error}</p>}
      <div className="toolbar-actions">
        <Button type="button" onClick={() => setDialog(null)}>Cancel</Button>
        <Button className={dialog.mode === 'delete' ? 'danger' : 'primary'} type="submit" disabled={busy}>{dialog.mode === 'create' ? 'Create project' : dialog.mode === 'rename' ? 'Save' : 'Delete project'}</Button>
      </div>
    </form>}
  </dialog>;

  if (projectId) {
    if (!project) return error ? <p role="alert">{error}</p> : <p role="status">Opening project…</p>;
    return <>
      {step !== 'edit' && <div className="page-heading playground-heading">
        <div><p className="eyebrow">{project.name}</p><h1>{current.label}</h1><p>{current.blurb}</p></div>
        <Button onClick={() => setDialog({ mode: 'rename', project })}><PencilSimple size={16}/>Rename</Button>
      </div>}
      {step === 'script' ? <Script project={project} onSaved={setProject} onShots={() => onOpen(project.id, 'shots')}/>
        : step === 'shots' ? <Shots project={project} onScript={() => onOpen(project.id, 'script')} onEdit={() => onOpen(project.id, 'edit')}/>
        : step === '3d' ? <Visual3D project={project} onShots={() => onOpen(project.id, 'shots')}/>
        : <Edit project={project}/>}
      {nameDialog}
    </>;
  }

  return <>
    <div className="page-heading playground-heading">
      <div><h1>Playground</h1><p>Each project takes an idea from script to shots, 3D and a finished edit.</p></div>
      {!!projects?.length && <Button className="primary" onClick={() => setDialog({ mode: 'create' })}><Plus size={16} weight="bold"/>New project</Button>}
    </div>
    {error && !dialog && <p role="alert">{error}</p>}
    {!projects ? !error && <p role="status">Loading projects…</p>
      : !projects.length ? <div className="glass"><Empty title="Create your first project" body="Name it, then write or generate a script, break it into shots, block it out in 3D and edit the video."><Button className="primary" onClick={() => setDialog({ mode: 'create' })}><Plus size={16} weight="bold"/>Create project</Button></Empty></div>
      : <ul className="project-list glass">{projects.map(p => <li key={p.id} className="project-row">
        <button className="project-open" onClick={() => onOpen(p.id, 'script')}>
          <span className="project-original" aria-hidden><FolderSimple size={26}/></span>
          <span className="project-summary"><strong>{p.name}</strong><small>{p.script.trim() ? `${p.script.trim().split(/\s+/).length} word script` : 'No script yet'} · Updated {new Date(p.updated_at).toLocaleDateString()}</small></span>
          <ArrowRight size={20} aria-hidden/>
        </button>
        <Button aria-label={`Rename ${p.name}`} onClick={() => setDialog({ mode: 'rename', project: p })}><PencilSimple size={16}/></Button>
        <Button aria-label={`Delete ${p.name}`} onClick={() => setDialog({ mode: 'delete', project: p })}><Trash size={16}/></Button>
      </li>)}</ul>}
    {nameDialog}
  </>;
}
