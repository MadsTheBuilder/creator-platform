import type { Project } from '../../data/projects';
import { Button, Empty } from '../../components/ui';
import { useBreakdown } from './Shots';

// 2D storyboards of the shot breakdown, made with HyperFrames. Generation comes next; until then
// the step only explains itself.
export function Storyboard({ project, onShots }: { project: Project; onShots: () => void }) {
  const { breakdown } = useBreakdown(project.id);
  const ready = breakdown?.status === 'done';
  return <div className="glass">
    {ready
      ? <Empty title="No storyboards yet" body="Storyboards made with HyperFrames from this project's shot breakdown will show here: one panel per shot, with its framing, camera, light and timing."/>
      : <Empty title="Break down the script first" body="A storyboard is drawn from the shot breakdown, one panel per shot."><Button className="primary" onClick={onShots}>Go to shot breakdown</Button></Empty>}
  </div>;
}
