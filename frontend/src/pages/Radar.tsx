import { useEffect, useState, type FormEvent } from 'react';
import { Archive, ArrowClockwise, ArrowUUpLeft, Bell, BookmarkSimple, CalendarPlus, FileText, Newspaper, Sparkle, Trash, X, YoutubeLogo } from '@phosphor-icons/react';
import { Button, Empty, Notice } from '../components/ui';
import { useSession } from '../data/hooks';
import { createItem } from '../data/plan';
import { decide, deleteIdea, loadRadar, markSeen, requestRun, saveProfile, useRadarChanges, type Evidence, type Idea, type Radar as RadarData, type Review, type Run } from '../data/radar';
import './radar.css';

// What each topic-radar label means, in the creator's terms. Growth words only where it was measured.
const LABELS: Record<string, string> = {
  Rising: 'Smaller channels are beating their usual views on this, and searches are growing.',
  Spike: 'A burst of views right now, without measured search growth yet.',
  Peaked: 'Views are slowing down compared with the last check.',
  Flat: 'No clear growth in views or searches.',
  Saturated: 'Many videos on this in the last 14 days.',
  Covered: 'Close to one of your own videos. Only worth it with a new angle.',
};
const KIND: Record<Evidence['kind'], { label: string; icon: typeof Newspaper }> = {
  document: { label: 'Official document', icon: FileText }, news: { label: 'News', icon: Newspaper }, video: { label: 'Video', icon: YoutubeLogo },
};
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
const RUN: Record<Run['status'], string> = { queued: 'Waiting to start', running: 'Working (this takes a few minutes)', done: 'Finished', failed: 'Stopped' };

export function Radar({ onConnections }: { onConnections: () => void }) {
  const session = useSession();
  const changes = useRadarChanges(session?.user.id);
  const [data, setData] = useState<RadarData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () => loadRadar().then(d => { setData(d); setError(''); }, e => setError(e.message));
  useEffect(() => { if (session) void reload(); }, [session?.user.id, changes]);

  if (session === undefined) return <p role="status">Checking your account…</p>;
  if (!session) return <Empty title="Sign in to get video ideas" body="Ideas and the stories you watch are saved privately to your account."><Button className="primary" onClick={onConnections}>Go to sign-in</Button></Empty>;
  if (!data) return error ? <div className="notice" role="alert">{error} <Button onClick={reload}>Try again</Button></div> : <p role="status">Loading your ideas…</p>;

  async function act(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const latest = (kind: Run['kind']) => data.runs.find(r => r.kind === kind);
  const active = (kind: Run['kind']) => ['queued', 'running'].includes(latest(kind)?.status ?? '');
  const saved = data.ideas.filter(i => i.status === 'saved'), fresh = data.ideas.filter(i => i.status === 'new'), archived = data.ideas.filter(i => i.status === 'archived');
  const lastScan = data.runs.find(r => r.kind === 'scan' && r.status === 'done');

  return <div className="radar">
    <div className="radar-head">
      <div>
        <p className="eyebrow">{data.profile?.channel ? `${data.profile.channel.name} · ${data.profile.channel.subs.toLocaleString()} subscribers` : 'Video ideas'}</p>
        <p className="muted">New ideas every week, saved stories checked every day. Last scan: {when(lastScan?.finished_at ?? null)}.</p>
      </div>
      {data.profile && <div className="toolbar-actions">
        <Button disabled={busy || active('watch') || !saved.length} onClick={() => act(() => requestRun('watch'))}><ArrowClockwise size={16} aria-hidden/>Check saved stories</Button>
        <Button className="primary" disabled={busy || active('scan')} onClick={() => act(() => requestRun('scan'))}><Sparkle size={16} aria-hidden/>Find new ideas</Button>
      </div>}
    </div>
    {error && <div className="notice" role="alert">{error}</div>}
    {(['scan', 'watch'] as const).map(kind => { const run = latest(kind); return run && run.status !== 'done' && <div key={kind} className="radar-run" role="status">
      <strong>{kind === 'scan' ? 'Finding new ideas' : 'Checking saved stories'}:</strong> {RUN[run.status]}{run.error && ` · ${run.error}`}
    </div>; })}

    <ProfileForm data={data} busy={busy} onSave={fields => act(() => saveProfile(fields, !!data.profile))}/>

    {data.profile && <>
      <section aria-labelledby="radar-watching">
        <h2 id="radar-watching"><Bell size={20} aria-hidden/> Watching <span className="muted">({saved.length})</span></h2>
        {!saved.length && <p className="muted">Save an idea to get daily updates on it: new reports, official documents and videos.</p>}
        {saved.map(idea => <Watched key={idea.id} idea={idea} updates={data.updates.filter(u => u.idea_id === idea.id)} reviews={data.reviews.filter(r => r.idea_id === idea.id)} busy={busy} act={act}/>)}
      </section>
      <section aria-labelledby="radar-new">
        <h2 id="radar-new"><Sparkle size={20} aria-hidden/> New ideas <span className="muted">({fresh.length})</span></h2>
        {!fresh.length && <p className="muted">{active('scan') ? 'Finding ideas now. They appear here when the scan finishes.' : 'No new ideas yet. Press "Find new ideas".'}</p>}
        <div className="radar-cards">{fresh.map(idea => <IdeaCard key={idea.id} idea={idea} reviews={data.reviews.filter(r => r.idea_id === idea.id)} busy={busy} act={act}/>)}</div>
      </section>
      {archived.length > 0 && <details className="radar-archive">
        <summary><Archive size={16} aria-hidden/> Archived <span className="muted">({archived.length})</span></summary>
        <p className="muted">Kept out of new scans. Restore one to put it back in New ideas, or delete it for good.</p>
        <ul>{archived.map(idea => <li key={idea.id}>
          <span>{idea.name}</span>
          <span className="toolbar-actions">
            <Button disabled={busy} onClick={() => act(() => decide(idea.id, 'new'))}><ArrowUUpLeft size={16} aria-hidden/>Restore</Button>
            <Button disabled={busy} aria-label={`Delete ${idea.name}`} onClick={() => { if (window.confirm(`Delete "${idea.name}" for good? Its sources and reviews go with it.`)) act(() => deleteIdea(idea.id)); }}><Trash size={16} aria-hidden/>Delete</Button>
          </span>
        </li>)}</ul>
      </details>}
    </>}
  </div>;
}

function ProfileForm({ data, busy, onSave }: { data: RadarData; busy: boolean; onSave: (f: { channel_url: string; format: 'shorts' | 'long' | 'both'; region: string; seeds: string[]; buckets: string[] }) => void }) {
  const p = data.profile;
  const list = (s: FormDataEntryValue | null) => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 8);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSave({ channel_url: String(f.get('channel_url')).trim(), format: f.get('format') as 'shorts', region: 'IN', seeds: list(f.get('seeds')), buckets: list(f.get('buckets')) });
  }
  return <details className="glass radar-profile" open={!p}>
    <summary>Channel and topics</summary>
    <form onSubmit={submit}>
      <label>Channel link<input name="channel_url" required defaultValue={p?.channel_url} placeholder="https://www.youtube.com/@handle"/></label>
      <label>Format<select name="format" defaultValue={p?.format ?? 'both'}><option value="shorts">Shorts</option><option value="long">Long videos</option><option value="both">Both</option></select></label>
      <label>Topics to search (comma separated, up to 8)<input name="seeds" required defaultValue={p?.seeds.join(', ')} placeholder="supreme court india, election commission india"/></label>
      <label>Your recurring angles (comma separated)<input name="buckets" defaultValue={p?.buckets.join(', ')} placeholder="power of an institution, consumer rights"/></label>
      <Button className="primary" disabled={busy}>Save</Button>
    </form>
  </details>;
}

function Facts({ idea }: { idea: Idea }) {
  const m = idea.metrics;
  return <ul className="radar-facts">
    {m.breakout > 0 && <li>Best peer video: <strong>{m.breakout}×</strong> its channel's usual views</li>}
    {m.slope !== null && <li>Searches: <strong>{m.slope >= 1 ? '+' : ''}{Math.round((m.slope - 1) * 100)}%</strong> vs the previous 2 months</li>}
    <li><strong>{m.uploads_14d}</strong> videos on it in 14 days</li>
    {m.newest_days !== null && <li>Newest evidence <strong>{m.newest_days}</strong> days old</li>}
  </ul>;
}

function EvidenceList({ items }: { items: Evidence[] }) {
  return <ul className="radar-evidence">{items.map(e => { const K = KIND[e.kind]; return <li key={e.url} className={e.kind === 'document' ? 'radar-document' : undefined}>
    <K.icon size={16} aria-label={K.label}/><a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> <span className="muted">· {e.source}{e.date && ` · ${e.date}`}</span>
  </li>; })}</ul>;
}

// The planned video stays linked to the idea, so the creator's Claude or Codex can outline it from the sources (get_plan_item).
// A new idea is saved too: the next scan replaces new ideas, and a planned story is worth watching.
async function toPlanner(idea: Idea) {
  const links = idea.evidence.slice(0, 8).map(e => `- ${e.title} (${e.source}) ${e.url}`).join('\n');
  await createItem({ title: idea.name.slice(0, 140), platform: 'youtube', radar_idea_id: idea.id, notes: `${idea.summary}\n\nAngle: ${idea.angle}\n\nSources:\n${links}`.slice(0, 5000) });
  if (idea.status === 'new') await decide(idea.id, 'saved');
}

const VERDICT: Record<Review['verdict'], string> = { keep: 'looks right', fix: 'suggests a fix', drop: 'suggests dropping it' };
function Reviews({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) return null;
  const r = reviews[0], s = r.suggestion;
  return <div className={`radar-review radar-review-${r.verdict}`}>
    <p><strong>{r.reviewer === 'codex' ? 'Codex' : r.reviewer === 'claude' ? 'Claude' : 'A reviewer'} {VERDICT[r.verdict]}:</strong> {r.notes}</p>
    {s.name && <p><span className="muted">Name:</span> {s.name}</p>}
    {s.summary && <p><span className="muted">Summary:</span> {s.summary}</p>}
    {s.angle && <p><span className="muted">Angle:</span> {s.angle}</p>}
    <p className="muted">{r.model ? `${r.model} · ` : ''}{when(r.created_at)}{reviews.length > 1 ? ` · ${reviews.length - 1} earlier review${reviews.length > 2 ? 's' : ''}` : ''}</p>
  </div>;
}

function IdeaCard({ idea, reviews, busy, act }: { idea: Idea; reviews: Review[]; busy: boolean; act: (w: () => Promise<unknown>) => void }) {
  return <article className="glass radar-card">
    <div className="radar-card-head"><h3>{idea.name}</h3><span className={`radar-label radar-${idea.label.toLowerCase()}`} title={LABELS[idea.label]}>{idea.label}</span></div>
    <p className="muted radar-label-why">{LABELS[idea.label]}</p>
    {idea.metrics.covered_by && <Notice>Similar to your video “{idea.metrics.covered_by}”.</Notice>}
    <p>{idea.summary}</p>
    {idea.angle && <p><strong>Angle{idea.bucket && ` (${idea.bucket})`}:</strong> {idea.angle}</p>}
    <Facts idea={idea}/>
    <Reviews reviews={reviews}/>
    <details><summary>Sources ({idea.evidence.length})</summary><EvidenceList items={idea.evidence}/></details>
    <div className="toolbar-actions">
      <Button className="primary" disabled={busy} onClick={() => act(() => decide(idea.id, 'saved'))}><BookmarkSimple size={16} aria-hidden/>Save and watch</Button>
      <Button disabled={busy} onClick={() => act(() => toPlanner(idea))}><CalendarPlus size={16} aria-hidden/>Add to Planner</Button>
      <Button disabled={busy} onClick={() => act(() => decide(idea.id, 'archived'))}><Archive size={16} aria-hidden/>Archive</Button>
      <Button disabled={busy} onClick={() => act(() => decide(idea.id, 'dropped'))}><X size={16} aria-hidden/>Not for me</Button>
    </div>
  </article>;
}

function Watched({ idea, updates, reviews, busy, act }: { idea: Idea; updates: RadarData['updates']; reviews: Review[]; busy: boolean; act: (w: () => Promise<unknown>) => void }) {
  const unread = updates.filter(u => !u.seen);
  return <article className="glass radar-card radar-watched">
    <div className="radar-card-head"><h3>{idea.name}</h3>{unread.length > 0 && <span className="radar-unread">{unread.length} new</span>}</div>
    <p>{idea.change_note ?? 'Not checked yet. The first check runs within a day, or press "Check saved stories".'}</p>
    <p className="muted">Last checked {when(idea.last_checked)}</p>
    <Reviews reviews={reviews}/>
    {updates.length > 0 && <details open={unread.length > 0}><summary>Updates ({updates.length})</summary>
      <EvidenceList items={updates.slice(0, 30).map(u => ({ kind: u.kind, title: `${u.seen ? '' : '● '}${u.title}`, url: u.url, source: u.source ?? '', date: u.published ?? '' }))}/>
    </details>}
    <div className="toolbar-actions">
      {unread.length > 0 && <Button disabled={busy} onClick={() => act(() => markSeen(unread.map(u => u.id)))}>Mark as read</Button>}
      <Button disabled={busy} onClick={() => act(() => toPlanner(idea))}><CalendarPlus size={16} aria-hidden/>Add to Planner</Button>
      <Button disabled={busy} onClick={() => act(() => decide(idea.id, 'new'))}><X size={16} aria-hidden/>Stop watching</Button>
      <Button disabled={busy} onClick={() => act(() => decide(idea.id, 'archived'))}><Archive size={16} aria-hidden/>Archive</Button>
    </div>
  </article>;
}
