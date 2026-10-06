import { useAppServer } from '../../data/hooks';
import type { Project } from '../../data/projects';
import { Notice } from '../../components/ui';

// The full HyperFrames Studio for this project, served by the app server. It starts empty: the
// shot breakdown never fills it on its own.
export function Edit({ project }: { project: Project }) {
  const server = useAppServer();
  if (server === 'connecting') return <p role="status">Opening the editor…</p>;
  if (server !== 'ready') return <p role="alert">{server}</p>;
  return <>
    <div className="editor-narrow"><Notice>The editor needs a screen at least 1024 px wide. Open this project on a laptop or desktop.</Notice></div>
    <iframe className="studio-frame" title={`HyperFrames editor: ${project.name}`} src={`/studio/${project.id}/#project/${project.id}`} allow="autoplay; clipboard-read; clipboard-write; fullscreen"/>
  </>;
}
