import { useEffect, useState } from 'react';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { api } from '../../data/app-server';
import { useAppServer, useProjectChanges } from '../../data/hooks';
import type { Project } from '../../data/projects';
import { latestJob, type TranscribeJob } from '../../data/video-jobs';
import { Button, Empty } from '../../components/ui';

type Board = { round: number; made_at: string; frames: { beat: string; at: number; file: string; note?: string }[]; note?: string; notes_at?: string };

// Studio track: the creator's own Claude builds the video over MCP (the free server model can't author
// motion graphics). This step shows what it has to work with, the beat board the creator annotates before the
// full build, and the frames it last looked at.
export function Build({ project, onEdit }: { project: Project; onEdit: () => void }) {
  const server = useAppServer();
  const [recording, setRecording] = useState<TranscribeJob | null>(null);
  const [frames, setFrames] = useState(true);
  const [board, setBoard] = useState<Board | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [overall, setOverall] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changes = useProjectChanges(project.id);
  const base = `/api/playground/${project.id}`;
  useEffect(() => { latestJob<TranscribeJob>('transcribe', { projectId: project.id }).then(setRecording, () => {}); }, [project.id, changes]);
  useEffect(() => setFrames(true), [project.updated_at]);
  // A new round replaces the notes; within a round, typing the creator hasn't saved is never overwritten.
  useEffect(() => {
    if (server !== 'ready') return;
    api<Board | null>(`${base}/board`).then(next => {
      setBoard(prev => {
        if (!next || !dirty || prev?.round !== next.round) { setNotes(next?.frames.map(f => f.note ?? '') ?? []); setOverall(next?.note ?? ''); setDirty(false); }
        return next;
      });
    }, e => setError(e.message));
  }, [server, project.id, changes]);

  async function save() {
    if (!board) return;
    setBusy(true); setError('');
    try {
      const saved = await api<Board>(`${base}/board/notes`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ round: board.round, notes, note: overall }) });
      setBoard(saved); setDirty(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const edit = (i: number, text: string) => { setNotes(n => n.map((v, j) => j === i ? text : v)); setDirty(true); };

  const ready = [
    { done: recording?.status === 'done', label: 'Recording transcribed' },
    { done: !!project.direction.trim(), label: 'Direction written' },
    { done: !!project.beat_plan.trim(), label: 'Beat plan saved by your Claude (approve it in your chat)' },
    { done: !!board?.notes_at, label: 'Beat board reviewed: your notes saved for your Claude' },
  ];
  return <div className="storyboard">
    <section className="glass storyboard-form" aria-label="Build">
      <h2>Ask your Claude to build it</h2>
      <p className="muted">With the Content Engine connector in Claude or Codex, say: <strong>“Build my Studio video for {project.name}.”</strong> It plans the beats from your words, shows you one frame per beat here to comment on, then builds the video in code around your recording and checks its own frames. Each save appears in the editor.</p>
      <ul className="build-checklist">{ready.map(r => <li key={r.label}>{r.done ? <CheckCircle size={18} weight="fill" aria-label="Done"/> : <Circle size={18} aria-label="Not yet"/>}{r.label}</li>)}</ul>
      <Button className="primary" onClick={onEdit}>Open the editor</Button>
    </section>
    <section className="glass storyboard-form" aria-label="Latest frames">
      <h2>Latest frames</h2>
      {board && <>
        <div><h3 className="board-title">Beat board · round {board.round}</h3>
          <p className="muted">One frame per beat of your plan, before the full build. Write a note on any frame you want changed, save, then tell your Claude: <strong>“I left notes on the beat board.”</strong></p></div>
        <ol className="board-grid">{board.frames.map((f, i) => <li key={f.file}>
          <img src={`${base}/file/board/${f.file}?v=${encodeURIComponent(board.made_at)}`} alt={`${f.beat} at ${f.at} s`} loading="lazy"/>
          <label><span><strong>{f.beat}</strong> · {f.at}s</span>
            <textarea rows={2} maxLength={2000} value={notes[i] ?? ''} placeholder="What should change here?" onChange={e => edit(i, e.target.value)}/></label>
        </li>)}</ol>
        <label>Overall note<textarea rows={3} maxLength={4000} value={overall} placeholder="Anything about the whole video: pace, look, the webcam…" onChange={e => { setOverall(e.target.value); setDirty(true); }}/></label>
        {error && <p role="alert">{error}</p>}
        <div className="toolbar-actions">
          <Button className="primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save notes for your Claude'}</Button>
          <span className="muted" role="status">{dirty ? 'Unsaved notes' : board.notes_at ? `Saved ${new Date(board.notes_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        </div>
      </>}
      {server === 'ready' && frames
        ? <>{board && <h3 className="board-title">Last check</h3>}<img className="build-frames" alt="The frames your Claude last rendered to check its work" src={`${base}/file/snapshots/contact-sheet.jpg?v=${encodeURIComponent(project.updated_at)}`} onError={() => setFrames(false)}/></>
        : !board && <Empty title="No frames yet" body="After you approve the plan, your Claude shows one frame per beat here for your notes. When it checks its build, the frames it looked at show here too."/>}
    </section>
  </div>;
}
