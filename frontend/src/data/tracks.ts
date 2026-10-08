// The Playground's two tracks (projects.track), each with its own steps. A project picks one when it is
// created and keeps it. Both end in the same HyperFrames editor.
export type Track = 'production' | 'studio';
export type Step = 'script' | 'shots' | 'storyboard' | '3d' | 'ai' | 'direct' | 'build' | 'edit';
export type StepInfo = { step: Step; label: string; blurb: string };

const EDIT: StepInfo = { step: 'edit', label: 'Video edit', blurb: 'The full HyperFrames editor: timeline, keyframes, audio, blocks and render.' };
export const TRACKS: Record<Track, { label: string; blurb: string; steps: StepInfo[] }> = {
  production: {
    label: 'Production',
    blurb: 'Footage you shoot or generate with AI. Every shot is planned first: breakdown, 3D blockout, storyboard.',
    steps: [
      { step: 'script', label: 'Script', blurb: 'Write, upload or generate the script.' },
      { step: 'shots', label: 'Shot breakdown', blurb: 'Every shot with framing, lens, camera, light and timing.' },
      { step: '3d', label: '3D visual', blurb: 'Reference images and videos per shot, and Blender blockouts built on your PC.' },
      { step: 'storyboard', label: 'Storyboard', blurb: 'Your blockout as a shot-by-shot board: frames, camera, action, notes and audio.' },
      { step: 'ai', label: 'AI video', blurb: 'Timed prompts written from your blockout, and takes generated with your own Higgsfield account.' },
      EDIT,
    ],
  },
  studio: {
    label: 'Studio',
    blurb: 'Motion graphics built in code around your own recording, timed to your words and the music.',
    steps: [
      { step: 'direct', label: 'Direct', blurb: 'Describe the video, add references, upload your recording. Your Claude turns it into a beat plan.' },
      { step: 'build', label: 'Build', blurb: 'Your Claude builds the video in code around your recording, then checks its own frames.' },
      EDIT,
    ],
  },
};

const ALL = new Set<string>(Object.values(TRACKS).flatMap(t => t.steps.map(s => s.step)));
export const isStep = (step: string | undefined): step is Step => !!step && ALL.has(step);
export const stepsFor = (track: Track) => TRACKS[track].steps;
// The step to show: the one asked for if this track has it, else the track's first.
export const stepIn = (track: Track, step?: Step): Step => (stepsFor(track).find(s => s.step === step) ?? stepsFor(track)[0]).step;
