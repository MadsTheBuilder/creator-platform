import { useEffect, useState, type ChangeEvent } from 'react';
import { Desktop, DownloadSimple, Trash, UploadSimple } from '@phosphor-icons/react';
import { api } from '../../data/app-server';
import { useAppServer, usePolled, useProjectChanges } from '../../data/hooks';
import type { Project } from '../../data/projects';
import { active, latestJob, queueJob, type BlockoutJob } from '../../data/video-jobs';
import { Button, Empty, Notice } from '../../components/ui';
import { useBreakdown } from './Shots';

type Device = { id: string; name: string; created_at: string; last_seen: string | null };
type Reference = { shot: number; name: string };
const ONLINE_MS = 60_000;
const isVideo = (name: string) => /\.(mp4|mov|webm)$/i.test(name);

// Reference images/videos per shot, and Blender blockouts built by the helper on the creator's PC.
export function Visual3D({ project, onShots }: { project: Project; onShots: () => void }) {
  const server = useAppServer();
  const { breakdown } = useBreakdown(project.id);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [job, setJob] = useState<BlockoutJob | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const base = `/api/playground/${project.id}`;

  const loadRefs = () => api<Reference[]>(`${base}/references`).then(setRefs, e => setError(e.message));
  const loadDevices = () => api<Device[]>('/api/bridge/devices').then(setDevices, e => setError(e.message));
  useEffect(() => { if (server === 'ready') { loadRefs(); loadDevices(); } }, [server, project.id]);
  useEffect(() => { latestJob<BlockoutJob>('blockout', { projectId: project.id }).then(setJob, e => setError(e.message)); }, [project.id]);
  usePolled(job, setJob, setError);
  const changes = useProjectChanges(project.id);
  useEffect(() => { if (!changes) return; latestJob<BlockoutJob>('blockout', { projectId: project.id }).then(setJob, () => {}); if (server === 'ready') loadRefs(); }, [changes]);
  // While a blockout waits for the PC, keep the "online" dot fresh.
  useEffect(() => { if (!active(job) || server !== 'ready') return; const t = setInterval(loadDevices, 15_000); return () => clearInterval(t); }, [job?.status, server]);

  if (server !== 'ready') return server === 'connecting' ? <p role="status">Connecting…</p> : <p role="alert">{server}</p>;
  const board = breakdown?.status === 'done' ? breakdown.output : null;
  if (!board) return <div className="glass"><Empty title="Break down the script first" body="3D blockouts are built from the shot breakdown: camera position, angle, lens, move, light and timing for every shot."><Button className="primary" onClick={onShots}>Go to shot breakdown</Button></Empty></div>;

  let n = 0;
  const shots = board.scenes.flatMap(scene => scene.shots.map(shot => ({ no: ++n, scene: scene.heading, shot })));
  const online = devices?.some(d => d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS);

  async function upload(shot: number, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setBusy(`upload-${shot}`); setError('');
    try {
      for (const file of files) {
        const name = file.name.replace(/[^\w .()-]/g, '_').replace(/^[^\w]+/, '').slice(0, 120) || 'reference';
        await api(`${base}/references/${shot}/${encodeURIComponent(name)}`, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); loadRefs(); }
  }

  async function removeRef(ref: Reference) {
    setError('');
    try { await api(`${base}/references/${ref.shot}/${encodeURIComponent(ref.name)}`, { method: 'DELETE' }); } catch (e) { setError((e as Error).message); }
    loadRefs();
  }

  async function downloadHelper() {
    setBusy('pair'); setError('');
    try {
      const res = await fetch('/api/bridge/pair', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Could not prepare the helper. Please try again.');
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: 'creator-bridge.zip' });
      link.click();
      URL.revokeObjectURL(link.href);
      loadDevices();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  async function removeDevice(id: string) {
    setError('');
    try { await api(`/api/bridge/devices/${id}`, { method: 'DELETE' }); } catch (e) { setError((e as Error).message); }
    loadDevices();
  }

  async function build() {
    setBusy('build'); setError('');
    try { setJob(await queueJob<BlockoutJob>('blockout', { breakdown_id: breakdown!.id, shots: [...picked].sort((a, b) => a - b) }, project.id)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  const toggle = (no: number) => setPicked(p => { const next = new Set(p); if (!next.delete(no)) next.add(no); return next; });
  const file = (name: string) => `${base}/file/blockout/${job!.id}/${encodeURIComponent(name)}`;
  const done = job?.status === 'done' && job.output;

  return <div className="storyboard">
    <section className="glass storyboard-form" aria-label="Blender on your computer">
      <div className="section-toolbar">
        <div><h2>Blender on your computer</h2><p className="muted">Blockouts render with your own Blender through a small helper. Nothing renders on our servers.</p></div>
        <Button onClick={downloadHelper} disabled={busy === 'pair'}><DownloadSimple size={16}/>{devices?.length ? 'Connect another computer' : 'Download the helper'}</Button>
      </div>
      {devices?.length ? <ul className="device-list">{devices.map(d => {
        const live = d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS;
        return <li key={d.id}><Desktop size={18} aria-hidden/><span><strong>{d.name}</strong> <span className={`status-dot ${live ? 'on' : ''}`}/> {live ? 'Online' : d.last_seen ? `Last seen ${new Date(d.last_seen).toLocaleString()}` : 'Not started yet'}</span>
          <Button aria-label={`Disconnect ${d.name}`} onClick={() => removeDevice(d.id)}><Trash size={16}/></Button></li>;
      })}</ul>
        : <p className="muted">Download the helper, unzip it and start it (Windows: start-windows.bat; Mac/Linux: python3 creator_bridge.py). It needs Blender 4.2 or newer.</p>}
    </section>

    <section className="glass storyboard-form" aria-label="Shots">
      <div className="section-toolbar">
        <div><h2>Shots</h2><p className="muted">Pick the shots to block out. Add reference images or videos to any shot; they also appear in the editor's Assets panel.</p></div>
        <div className="toolbar-actions">
          <Button onClick={() => setPicked(picked.size === shots.length ? new Set() : new Set(shots.map(s => s.no)))}>{picked.size === shots.length ? 'Clear' : 'Select all'}</Button>
          <Button className="primary" disabled={!picked.size || !!busy || active(job)} onClick={build}>Build blockout{picked.size ? ` (${picked.size})` : ''}</Button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {active(job) && <Notice><span role="status">{job!.status === 'running' ? 'Blender is building the blockout on your computer…' : online ? 'Waiting for your computer to pick this up…' : 'Waiting for your computer. Start the helper to build this blockout.'}</span></Notice>}
      {job?.status === 'failed' && <p role="alert">{job.error}</p>}
      <ul className="shot-picker">{shots.map(({ no, scene, shot }) => <li key={no} className={picked.has(no) ? 'selected' : ''}>
        <label className="shot-pick"><input type="checkbox" checked={picked.has(no)} onChange={() => toggle(no)}/>
          <span><strong>{no}. {shot.description}</strong><small className="muted">{scene} · {shot.magnification} · {shot.lens}{/^\d+$/.test(shot.lens) ? 'mm' : ''} · {shot.angle} · {shot.movement} · {shot.duration}s</small></span></label>
        <div className="shot-refs">
          {refs.filter(r => r.shot === no).map(r => <figure key={r.name}>
            {isVideo(r.name) ? <video src={`${base}/file/references/shot-${no}/${encodeURIComponent(r.name)}`} muted preload="metadata"/> : <img src={`${base}/file/references/shot-${no}/${encodeURIComponent(r.name)}`} alt={r.name} loading="lazy"/>}
            <button className="ref-remove" aria-label={`Remove ${r.name}`} onClick={() => removeRef(r)}><Trash size={14}/></button>
          </figure>)}
          <label className="button ref-add" aria-busy={busy === `upload-${no}`}><UploadSimple size={16}/>{busy === `upload-${no}` ? 'Uploading…' : 'Reference'}<input className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={e => upload(no, e)}/></label>
        </div>
      </li>)}</ul>
    </section>

    {done && <section className="glass storyboard-result" aria-label="Blockout">
      <div className="section-toolbar">
        <div><h2>Blockout</h2><p className="muted">Shots {job.output!.shots.join(', ')}. The files are also in the editor's Assets panel.</p></div>
        {job.output!.files.includes('blockout.blend') && <a className="button" href={file('blockout.blend')} download="blockout.blend"><DownloadSimple size={16}/>.blend file</a>}
      </div>
      {job.output!.files.includes('preview.mp4') && <video className="storyboard-player" src={file('preview.mp4')} controls preload="metadata"/>}
      <div className="blockout-stills">{job.output!.files.filter(f => f.endsWith('.png')).map(f => <figure key={f}><img src={file(f)} alt={`Blockout still, ${f}`} loading="lazy"/><figcaption>Shot {Number(f.match(/\d+/)?.[0])}</figcaption></figure>)}</div>
    </section>}
  </div>;
}
