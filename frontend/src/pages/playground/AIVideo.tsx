import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, CheckCircle, Circle, Copy, Pause, Play } from '@phosphor-icons/react';
import { api } from '../../data/app-server';
import { useAppServer, useProjectChanges } from '../../data/hooks';
import type { Project } from '../../data/projects';
import { latestJob, type BlockoutJob } from '../../data/video-jobs';
import { Button, Empty, Notice } from '../../components/ui';

type AIVideoData = { prompts: string | null; blockout: string | null; takes: { name: string; bytes: number }[] };
type Section = { heading: string; text: string; blocks: string[] };

// The saved prompts file: the intro (Director's calls, Post), then a section per ## heading with its ``` blocks.
function sections(markdown: string): Section[] {
  const out: Section[] = [{ heading: '', text: '', blocks: [] }];
  let fence: string[] | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('```')) {
      if (fence) { out.at(-1)!.blocks.push(fence.join('\n')); fence = null; } else fence = [];
    } else if (fence) fence.push(line);
    else if (/^##+ /.test(line)) out.push({ heading: line.replace(/^##+ /, '').trim(), text: '', blocks: [] });
    else out.at(-1)!.text += `${line}\n`;
  }
  return out.filter(s => s.heading || s.text.trim());
}
// What the model gets (as worker/video-prompts.ts sendable): tags without their (path), no Duration line.
const sendable = (block: string) => block.replace(/^@Image(\d+) \([^)]+\)/gm, '@Image$1').replace(/^Duration:.*\n?/m, '').trim();
const tagged = (block: string) => [...block.matchAll(/^@Image(\d+) \(([^)]+)\)/gm)].map(m => ({ tag: `@Image${m[1]}`, path: m[2].trim() }));

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// A take played against the blockout its prompts follow: one clock, and a split the creator drags.
function Compare({ blockout, take, label }: { blockout: string; take: string; label: string }) {
  const front = useRef<HTMLVideoElement>(null), back = useRef<HTMLVideoElement>(null);
  const [split, setSplit] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const both = (f: (v: HTMLVideoElement) => void) => [front.current, back.current].forEach(v => v && f(v));
  const seek = (t: number) => { both(v => { v.currentTime = t; }); setTime(t); };
  const toggle = () => { if (playing) both(v => v.pause()); else both(v => { void v.play().catch(() => {}); }); setPlaying(!playing); };
  // The take is the clock; the blockout is pulled back into step when it drifts.
  const tick = () => {
    const t = back.current!.currentTime;
    setTime(t);
    if (front.current && Math.abs(front.current.currentTime - t) > 0.15) front.current.currentTime = t;
  };
  return <figure className="compare-figure">
    <div className="compare" style={{ '--split': `${split}%` } as React.CSSProperties}>
      <video ref={back} src={take} preload="auto" playsInline onLoadedMetadata={e => setLength(e.currentTarget.duration)} onTimeUpdate={tick} onEnded={() => { both(v => v.pause()); setPlaying(false); }}/>
      <video ref={front} className="compare-front" src={blockout} preload="auto" playsInline muted/>
      <span className="compare-label">Blockout</span><span className="compare-label right">Take</span>
      <input type="range" min={0} max={100} step={0.5} value={split} onChange={e => setSplit(Number(e.target.value))} aria-label="Split between the blockout and the take"/>
      <span className="compare-handle" aria-hidden><span><CaretLeft size={12} weight="bold"/><CaretRight size={12} weight="bold"/></span></span>
    </div>
    <div className="compare-controls">
      <Button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={16}/> : <Play size={16}/>}</Button>
      <input type="range" min={0} max={length || 0} step={0.04} value={time} onChange={e => seek(Number(e.target.value))} aria-label="Position"/>
      <span className="muted">{clock(time)} / {clock(length)}</span>
    </div>
    <figcaption>{label}</figcaption>
  </figure>;
}

// Production track, after the 3D visual: the prompts the creator's Claude wrote from the blockout, and the takes
// generated with the creator's own Higgsfield account. Writing and generating happen in their Claude, over MCP.
export function AIVideo({ project, on3d }: { project: Project; on3d: () => void }) {
  const server = useAppServer();
  const [data, setData] = useState<AIVideoData | null>(null);
  const [blockout, setBlockout] = useState<BlockoutJob | null>(null);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const changes = useProjectChanges(project.id);
  const base = `/api/playground/${project.id}`;
  useEffect(() => { if (server === 'ready') api<AIVideoData>(`${base}/ai-video`).then(setData, e => setError(e.message)); }, [server, project.id, changes]);
  useEffect(() => { latestJob<BlockoutJob>('blockout', { projectId: project.id }).then(setBlockout, () => {}); }, [project.id, changes]);

  if (server !== 'ready') return server === 'connecting' ? <p role="status">Connecting…</p> : <p role="alert">{server}</p>;
  if (!data) return error ? <p role="alert">{error}</p> : <p role="status">Loading…</p>;

  const preview = blockout?.status === 'done' && blockout.output?.files.includes('preview.mp4');
  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(c => c === key ? '' : c), 2000); }
    catch { setError('Copying was blocked by the browser. Select the text and copy it instead.'); }
  }

  return <div className="storyboard">
    <section className="glass storyboard-form" aria-label="Ask your Claude">
      <h2>Ask your Claude to write the prompts</h2>
      <p className="muted">With the Content Engine connector in Claude or Codex, say: <strong>“Write the AI video prompts for {project.name} from my blockout.”</strong> It reads the blockout's cuts and camera moves, the shot breakdown and your references, and writes a timed prompt for each segment. Each save is checked before it lands here.</p>
      <ul className="build-checklist">
        <li>{preview ? <CheckCircle size={18} weight="fill" aria-label="Done"/> : <Circle size={18} aria-label="Not yet"/>}A blockout with its preview video</li>
        <li>{data.prompts ? <CheckCircle size={18} weight="fill" aria-label="Done"/> : <Circle size={18} aria-label="Not yet"/>}Prompts saved by your Claude</li>
      </ul>
      {!preview && <Button onClick={on3d}>Go to 3D visual</Button>}
      <Notice><span>Takes are generated with <strong>your own Higgsfield account</strong>: the Higgsfield connector in your Claude, or your Higgsfield API key on your computer. We never hold your key, and your Claude tells you the cost before anything is spent.</span></Notice>
    </section>

    {error && <p role="alert">{error}</p>}

    {data.prompts ? <section className="glass storyboard-result" aria-label="Prompts">
      <h2>Prompts</h2>
      {sections(data.prompts).map((s, i) => <div key={i} className="prompt-section">
        {s.heading && <h3>{s.heading}</h3>}
        {s.text.trim() && <p className="prompt-notes">{s.text.trim()}</p>}
        {s.blocks.map((block, j) => <div key={j} className="prompt-block">
          <div className="section-toolbar">
            <div className="prompt-refs">{tagged(block).map(r => <figure key={r.tag}><img src={`${base}/file/${r.path.split('/').map(encodeURIComponent).join('/')}`} alt={r.path} loading="lazy"/><figcaption>{r.tag}</figcaption></figure>)}</div>
            <Button onClick={() => copy(`${i}-${j}`, sendable(block))}><Copy size={16}/>{copied === `${i}-${j}` ? 'Copied' : 'Copy prompt'}</Button>
          </div>
          <pre>{block}</pre>
        </div>)}
      </div>)}
    </section> : <div className="glass"><Empty title="No prompts yet" body="When your Claude saves the AI video prompts, they show here with a copy button for each segment and the reference images in the order to attach them."/></div>}

    {!!data.takes.length && <section className="glass storyboard-result" aria-label="Takes">
      <div><h2>Takes</h2><p className="muted">Newest first{data.blockout ? ', each played against the blockout its prompts follow: drag the split to compare framing and timing' : ''}. They are also in the editor's Assets panel for the cut.</p></div>
      {data.blockout
        ? data.takes.map(t => <Compare key={t.name} blockout={`${base}/file/${data.blockout!.split('/').map(encodeURIComponent).join('/')}`} take={`${base}/file/takes/${encodeURIComponent(t.name)}`} label={`${t.name} · ${(t.bytes / 1e6).toFixed(1)} MB`}/>)
        : <div className="take-grid">{data.takes.map(t => <figure key={t.name}>
          <video src={`${base}/file/takes/${encodeURIComponent(t.name)}`} controls preload="metadata"/>
          <figcaption>{t.name} · {(t.bytes / 1e6).toFixed(1)} MB</figcaption>
        </figure>)}</div>}
    </section>}
  </div>;
}
