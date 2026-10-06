import { useEffect, useState } from 'react';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { useAppServer, useProjectChanges } from '../../data/hooks';
import type { Project } from '../../data/projects';
import { latestJob, type TranscribeJob } from '../../data/video-jobs';
import { Button, Empty } from '../../components/ui';

// Studio track: the creator's own Claude builds the video over MCP (the free server model can't author
// motion graphics). This step shows what it has to work with and the frames it last looked at.
export function Build({ project, onEdit }: { project: Project; onEdit: () => void }) {
  const server = useAppServer();
  const [recording, setRecording] = useState<TranscribeJob | null>(null);
  const [frames, setFrames] = useState(true);
  const changes = useProjectChanges(project.id);
  useEffect(() => { latestJob<TranscribeJob>('transcribe', { projectId: project.id }).then(setRecording, () => {}); }, [project.id, changes]);
  useEffect(() => setFrames(true), [project.updated_at]);

  const ready = [
    { done: recording?.status === 'done', label: 'Recording transcribed' },
    { done: !!project.direction.trim(), label: 'Direction written' },
    { done: !!project.beat_plan.trim(), label: 'Beat plan saved by your Claude (approve it in your chat)' },
  ];
  return <div className="storyboard">
    <section className="glass storyboard-form" aria-label="Build">
      <h2>Ask your Claude to build it</h2>
      <p className="muted">With the Content Engine connector in Claude or Codex, say: <strong>“Build my Studio video for {project.name}.”</strong> It plans the beats from your words, builds the video in code around your recording, then renders frames and fixes what it sees. Each save appears in the editor.</p>
      <ul className="build-checklist">{ready.map(r => <li key={r.label}>{r.done ? <CheckCircle size={18} weight="fill" aria-label="Done"/> : <Circle size={18} aria-label="Not yet"/>}{r.label}</li>)}</ul>
      <Button className="primary" onClick={onEdit}>Open the editor</Button>
    </section>
    <section className="glass storyboard-form" aria-label="Latest frames">
      <h2>Latest frames</h2>
      {server === 'ready' && frames
        ? <img className="build-frames" alt="The frames your Claude last rendered to check its work" src={`/api/playground/${project.id}/file/snapshots/contact-sheet.jpg?v=${encodeURIComponent(project.updated_at)}`} onError={() => setFrames(false)}/>
        : <Empty title="No frames yet" body="When your Claude checks its build, the frames it looked at show here."/>}
    </section>
  </div>;
}
