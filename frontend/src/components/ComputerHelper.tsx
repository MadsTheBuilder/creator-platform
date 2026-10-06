import { useEffect, useState } from 'react';
import { Desktop, DownloadSimple, Trash } from '@phosphor-icons/react';
import { api } from '../data/app-server';
import { Button } from './ui';

// The helper on the creator's own computer (bridge/): Blender blockouts and recording transcripts run there.
export type Device = { id: string; name: string; created_at: string; last_seen: string | null };
const ONLINE_MS = 60_000;
const live = (d: Device) => !!d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS;

// The creator's paired computers; while `watching` (a job waits for one), the online dot stays fresh.
export function useDevices(ready: boolean, watching: boolean, setError: (e: string) => void) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const reload = () => api<Device[]>('/api/bridge/devices').then(setDevices, e => setError(e.message));
  useEffect(() => { if (ready) void reload(); }, [ready]);
  useEffect(() => { if (!ready || !watching) return; const t = setInterval(reload, 15_000); return () => clearInterval(t); }, [ready, watching]);
  return { devices, online: !!devices?.some(live), reload };
}

export function ComputerHelper({ title, body, setup, devices, reload, setError }: {
  title: string; body: string; setup: string; devices: Device[] | null; reload: () => void; setError: (e: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bridge/pair', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Could not prepare the helper. Please try again.');
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: 'creator-bridge.zip' });
      link.click();
      URL.revokeObjectURL(link.href);
      reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setError('');
    try { await api(`/api/bridge/devices/${id}`, { method: 'DELETE' }); } catch (e) { setError((e as Error).message); }
    reload();
  }

  return <section className="glass storyboard-form" aria-label={title}>
    <div className="section-toolbar">
      <div><h2>{title}</h2><p className="muted">{body}</p></div>
      <Button onClick={download} disabled={busy}><DownloadSimple size={16}/>{devices?.length ? 'Connect another computer' : 'Download the helper'}</Button>
    </div>
    {devices?.length ? <ul className="device-list">{devices.map(d => <li key={d.id}><Desktop size={18} aria-hidden/>
      <span><strong>{d.name}</strong> <span className={`status-dot ${live(d) ? 'on' : ''}`}/> {live(d) ? 'Online' : d.last_seen ? `Last seen ${new Date(d.last_seen).toLocaleString()}` : 'Not started yet'}</span>
      <Button aria-label={`Disconnect ${d.name}`} onClick={() => remove(d.id)}><Trash size={16}/></Button></li>)}</ul>
      : <p className="muted">Download the helper, unzip it and start it (Windows: start-windows.bat; Mac/Linux: python3 creator_bridge.py). {setup}</p>}
  </section>;
}
