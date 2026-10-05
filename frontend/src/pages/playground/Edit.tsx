import { useEffect, useState } from 'react';
import { api } from '../../data/app-server';
import { useAppServer } from '../../data/hooks';
import type { Project } from '../../data/projects';
import { Notice } from '../../components/ui';

// The full HyperFrames Studio for this project, served by the app server. Its first open starts
// from the project's latest storyboard.
export function Edit({ project }: { project: Project }) {
  const server = useAppServer();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setReady(false);
    if (server === 'ready') api(`/api/playground/${project.id}/seed`, { method: 'POST' }).then(() => setReady(true), e => setError(e.message));
  }, [server, project.id]);

  if (server !== 'ready' && server !== 'connecting') return <p role="alert">{server}</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!ready) return <p role="status">Opening the editor…</p>;
  return <>
    <div className="editor-narrow"><Notice>The editor needs a screen at least 1024 px wide. Open this project on a laptop or desktop.</Notice></div>
    <iframe className="studio-frame glass" title={`HyperFrames editor: ${project.name}`} src={`/studio/${project.id}/#project/${project.id}`} allow="autoplay; clipboard-read; clipboard-write; fullscreen"/>
  </>;
}
