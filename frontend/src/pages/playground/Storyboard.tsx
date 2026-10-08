import { useEffect, useState } from 'react';
import { api } from '../../data/app-server';
import { useAppServer, useProjectChanges } from '../../data/hooks';
import type { Project } from '../../data/projects';
import { Button, Empty } from '../../components/ui';
import { useBreakdown } from './Shots';

type BoardShot = { no: number; start: number; duration: number; frames: { file: string; at: number }[] };
type Board = { made_at: string; video: string; shots: BoardShot[] };

const lens = (l: string) => /^\d+$/.test(l) ? `${l}mm` : l.replace(/^(\d+) Macro$/i, '$1mm macro');
const pad = (n: number) => String(n).padStart(2, '0');
const videoLabel = (v: string) => v.startsWith('blockout/') ? `Blockout ${v.split('/')[1].slice(0, 8)}` : `Reference: ${v.replace(/^references\//, '')}`;
const frameLabel = (k: number, n: number) => k === 0 ? 'START' : k === n - 1 ? 'END' : n === 3 ? 'MID' : String(k + 1);

// The blockout as a shot-by-shot board: frames from the blockout video (worker/storyboard.ts), text from the live breakdown.
export function Storyboard({ project, onShots, onBlockout }: { project: Project; onShots: () => void; onBlockout: () => void }) {
  const server = useAppServer();
  const { breakdown } = useBreakdown(project.id);
  const [board, setBoard] = useState<Board | null>(null);
  const [videos, setVideos] = useState<string[]>([]);
  const [video, setVideo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/playground/${project.id}`;

  const load = () => api<{ storyboard: Board | null; videos: string[] }>(`${base}/storyboard`)
    .then(r => { setBoard(r.storyboard); setVideos(r.videos); setVideo(v => r.videos.includes(v) ? v : r.videos[0] ?? ''); }, e => setError(e.message));
  const changes = useProjectChanges(project.id);
  useEffect(() => { if (server === 'ready') load(); }, [server, project.id, changes]);

  if (server !== 'ready') return server === 'connecting' ? <p role="status">Connecting…</p> : <p role="alert">{server}</p>;
  const sheet = breakdown?.status === 'done' ? breakdown.output : null;
  if (!sheet) return <div className="glass"><Empty title="Break down the script first" body="The storyboard is laid out from the shot breakdown and its 3D blockout, one row per shot."><Button className="primary" onClick={onShots}>Go to shot breakdown</Button></Empty></div>;
  if (!videos.length && !board) return <div className="glass"><Empty title="Build a blockout first" body="The storyboard takes its frames from the 3D blockout: the start, middle and end of every shot."><Button className="primary" onClick={onBlockout}>Go to 3D visual</Button></Empty></div>;

  async function make() {
    setBusy(true); setError('');
    try { setBoard(await api<Board>(`${base}/storyboard`, { method: 'POST', body: JSON.stringify({ video }), headers: { 'Content-Type': 'application/json' } })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const shots = sheet.scenes.flatMap(s => s.shots);
  const total = shots.length;
  const img = (file: string) => `${base}/file/${file}?v=${board ? Date.parse(board.made_at) : 0}`;

  return <div className="storyboard">
    <section className="glass storyboard-form" aria-label="Make the storyboard">
      <div className="section-toolbar">
        <div><h2>{board ? 'Storyboard' : 'No storyboard yet'}</h2><p className="muted">{board ? `From ${videoLabel(board.video)}, ${new Date(board.made_at).toLocaleString()}.` : 'Frames come from a blockout video, three per shot (six for shots of 9 s or more).'}</p></div>
        <div className="toolbar-actions">
          {videos.length > 0 && <select aria-label="Video" value={video} onChange={e => setVideo(e.target.value)}>{videos.map(v => <option key={v} value={v}>{videoLabel(v)}</option>)}</select>}
          <Button className="primary" disabled={!video || busy} onClick={make}>{busy ? 'Making…' : board ? 'Make again' : 'Make storyboard'}</Button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>

    {board && <>
      <section className="glass storyboard-result" aria-label="Overview">
        <h2>{sheet.title} · {board.shots.length} shots, {board.shots.reduce((n, s) => n + s.duration, 0)} s</h2>
        <ol className="board-overview">{board.shots.map(s => {
          const shot = shots[s.no - 1], mid = s.frames[Math.floor(s.frames.length / 2)];
          return <li key={s.no}><button aria-label={`Go to shot ${s.no}`} onClick={() => document.getElementById(`board-shot-${s.no}`)?.scrollIntoView({ behavior: 'smooth' })}><img src={img(mid.file)} alt="" loading="lazy"/></button>
            <span>{pad(s.no)}{shot && ` · ${shot.magnification} · ${lens(shot.lens)}`} · {s.duration}s</span></li>;
        })}</ol>
      </section>

      {board.shots.map(s => {
        const shot = shots[s.no - 1];
        const rows: [string, string][] = shot ? [['Camera', [lens(shot.lens), shot.magnification, shot.angle, shot.movement].filter(Boolean).join('  ·  ')],
          ['Action', shot.description], ['Notes', shot.notes], ['Audio', shot.audio]] : [];
        return <article key={s.no} id={`board-shot-${s.no}`} className="glass board-shot">
          <header><strong>SHOT {pad(s.no)}</strong><h3>{shot?.description.split('.')[0] ?? 'Not in the breakdown any more'}</h3>
            <span>{pad(s.no)} / {total}  {s.start}–{s.start + s.duration} s ({s.duration} s)</span></header>
          <div className="board-frames">{s.frames.map((f, k) => <figure key={f.file}><img src={img(f.file)} alt={`Shot ${s.no}, ${f.at.toFixed(2)} s`} loading="lazy"/>
            <figcaption>{frameLabel(k, s.frames.length)} · {f.at.toFixed(2)} s</figcaption></figure>)}</div>
          <dl>{rows.filter(([, text]) => text).map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
        </article>;
      })}
    </>}
  </div>;
}
