import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { CaretLeft, CaretRight, CheckCircle, InstagramLogo, LinkBreak, LinkSimple, Plus, Sparkle, TiktokLogo, Tray, X, YoutubeLogo, type Icon } from '@phosphor-icons/react';
import { usePlanChanges, useSession } from '../data/hooks';
import { STATUSES, addDays, progressLabel, createItem, deleteItem, linkedProjects, listPlan, matchCandidates, monthGrid, toDay, updateItem, type Platform, type PlanFields, type PlanItem, type Status, type Upload } from '../data/plan';
import { createProject, listProjects, type Project } from '../data/projects';
import { youtubeRequest, type YouTubeSnapshot } from '../data/youtube';
import { socialRequest, type SocialSnapshot } from '../data/social';
import { Button, Empty, Thumb } from '../components/ui';
import { TRACKS, type Track } from '../data/tracks';

const PLATFORMS: Record<Platform, { label: string; icon: Icon }> = {
  youtube: { label: 'YouTube', icon: YoutubeLogo }, instagram: { label: 'Instagram', icon: InstagramLogo }, tiktok: { label: 'TikTok', icon: TiktokLogo },
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const AGENDA_DAYS = 14;
const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, opts);
const narrow = () => window.matchMedia('(max-width: 767px)').matches;

type Editing = { item: PlanItem } | { day: string | null } | null;

export function Planner({ onOpenProject, onConnections }: { onOpenProject: (id: string) => void; onConnections: () => void }) {
  const session = useSession();
  const today = toDay(new Date());
  const [month, setMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [view, setView] = useState<'month' | 'agenda'>(() => narrow() ? 'agenda' : 'month');
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [over, setOver] = useState<string | null>(null);
  const [board, setBoard] = useState<string | null>(null);

  const grid = monthGrid(month.year, month.month);
  const agenda = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(today, i));
  // One load covers both views, so switching between them never refetches.
  const from = grid[0] < today ? grid[0] : today, to = grid[41] > agenda[AGENDA_DAYS - 1] ? grid[41] : agenda[AGENDA_DAYS - 1];
  const changes = usePlanChanges(session?.user.id);
  const reload = () => listPlan(from, to).then(setItems, e => setError(e.message));
  useEffect(() => { if (session) void reload(); }, [session?.user.id, from, to, changes]);

  if (session === undefined) return <p role="status">Checking your account…</p>;
  if (!session) return <Empty title="Sign in to use the Planner" body="Your plan is saved to your account."><Button className="primary" onClick={onConnections}>Go to sign-in</Button></Empty>;

  const byDay = new Map<string, PlanItem[]>();
  items?.forEach(i => { const k = i.scheduled_on ?? ''; byDay.set(k, [...(byDay.get(k) ?? []), i]); });
  const inbox = byDay.get('') ?? [];

  // A changed project link drops the old progress; the realtime reload brings the new project's.
  const saved = (item: PlanItem) => setItems(xs => xs && (xs.some(x => x.id === item.id) ? xs.map(x => x.id === item.id ? { ...item, progress: x.project_id === item.project_id ? x.progress : undefined } : x) : [item, ...xs]));
  // Moves (day or stage) show at once and roll back by reloading if the save fails.
  async function patch(id: string, fields: Pick<PlanFields, 'scheduled_on' | 'status'>) {
    const item = items?.find(i => i.id === id);
    if (!item || Object.entries(fields).every(([k, v]) => item[k as keyof PlanItem] === v)) return;
    setItems(xs => xs && xs.map(x => x.id === id ? { ...x, ...fields } : x));
    try { saved(await updateItem(id, fields)); setError(''); } catch (e) { setError((e as Error).message); void reload(); }
  }
  const move = (id: string, day: string | null) => patch(id, { scheduled_on: day });
  // Drag and drop moves items between days and the inbox; the item dialog's date field does the same from the keyboard.
  const drop = (day: string | null) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(day ?? 'inbox'); },
    onDragLeave: () => setOver(null),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(null); void move(e.dataTransfer.getData('text/plain'), day); },
  });
  const card = (item: PlanItem) => {
    const P = item.platform ? PLATFORMS[item.platform].icon : null;
    return <li key={item.id}>
      <button className={`plan-card status-${item.status}`} draggable onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; }} onClick={() => setEditing({ item })}>
        <span className="plan-card-title">{P && <P size={14} aria-label={PLATFORMS[item.platform!].label}/>}{item.status === 'posted' && <CheckCircle size={14} weight="fill" aria-label="Posted"/>}<span>{item.title}</span></span>
        <small>{item.scheduled_time && <>{item.scheduled_time.slice(0, 5)} · </>}{STATUSES.find(s => s.status === item.status)!.label}{item.progress && <> · {progressLabel(item.progress)}</>}</small>
      </button>
    </li>;
  };
  const day = (d: string, outside = false) => {
    const list = byDay.get(d) ?? [];
    const label = dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' });
    // Clicking the day (its number or any empty space in it) opens that day's stage board.
    return <li key={d} className={`plan-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''} ${outside ? 'outside' : ''} ${over === d ? 'over' : ''}`} {...drop(d)}
      onClick={e => { if (!(e.target as HTMLElement).closest('button')) setBoard(d); }}>
      <div className="plan-day-head">
        <button className="plan-day-open" onClick={() => setBoard(d)} aria-label={`${label}${d === today ? ', today' : ''}: open the day's board`}>{view === 'agenda' ? label : Number(d.slice(8))}</button>
        <button className="plan-add" onClick={() => setEditing({ day: d })} aria-label={`Plan a video on ${label}`}><Plus size={14}/></button>
      </div>
      {list.length ? <ul className="plan-cards">{list.map(card)}</ul> : view === 'agenda' && <p className="muted plan-none">Nothing planned</p>}
    </li>;
  };

  async function quickAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget, title = String(new FormData(form).get('title') ?? '').trim();
    if (!title) return;
    try { saved(await createItem({ title })); form.reset(); setError(''); } catch (err) { setError((err as Error).message); }
  }
  const shift = (n: number) => setMonth(({ year, month: m }) => ({ year: year + Math.floor((m + n) / 12), month: (m + n + 12) % 12 }));

  return <div className="planner">
    <div className="plan-toolbar">
      {view === 'month'
        ? <div className="toolbar-actions">
          <button className="button plan-icon" onClick={() => shift(-1)} aria-label="Previous month"><CaretLeft size={16}/></button>
          <h2 aria-live="polite">{dayLabel(grid[15], { month: 'long', year: 'numeric' })}</h2>
          <button className="button plan-icon" onClick={() => shift(1)} aria-label="Next month"><CaretRight size={16}/></button>
          <Button onClick={() => { const d = new Date(); setMonth({ year: d.getFullYear(), month: d.getMonth() }); }}>Today</Button>
        </div>
        : <h2>Next two weeks</h2>}
      <div className="platform-tabs" role="group" aria-label="Calendar view">
        {(['month', 'agenda'] as const).map(v => <button key={v} className={view === v ? 'active' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'month' ? 'Month' : 'Agenda'}</button>)}
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="plan-layout" aria-busy={!items}>
      {view === 'month'
        ? <section className="glass plan-month" aria-label="Month">
          <div className="plan-weekdays" aria-hidden>{WEEKDAYS.map(w => <span key={w}>{w}</span>)}</div>
          <ol className="plan-grid">{grid.map(d => day(d, Number(d.slice(5, 7)) - 1 !== month.month))}</ol>
        </section>
        : <section className="glass plan-agenda" aria-label="Agenda"><ol>{agenda.map(d => day(d))}</ol></section>}
      <aside className={`glass plan-inbox ${over === 'inbox' ? 'over' : ''}`} aria-label="Ideas inbox" {...drop(null)}>
        <h2><Tray size={18}/>Ideas</h2>
        <p className="muted">Unscheduled ideas. Drag one onto a day, or drag a planned video back here.</p>
        <form className="plan-quick" onSubmit={quickAdd}>
          <input name="title" maxLength={140} placeholder="New video idea" aria-label="New video idea" autoComplete="off"/>
          <button className="button primary plan-icon" type="submit" aria-label="Add idea"><Plus size={16} weight="bold"/></button>
        </form>
        {items && (inbox.length ? <ul className="plan-cards">{inbox.map(card)}</ul> : <p className="muted plan-none">No ideas waiting.</p>)}
      </aside>
    </div>
    <DayBoard day={board} items={board ? byDay.get(board) ?? [] : []} error={error} onClose={() => setBoard(null)} onStatus={(id, status) => void patch(id, { status })}
      onOpen={item => setEditing({ item })} onAdd={() => setEditing({ day: board })}/>
    <ItemDialog editing={editing} onClose={() => setEditing(null)} onSaved={saved} onDeleted={id => setItems(xs => xs && xs.filter(x => x.id !== id))} onOpenProject={onOpenProject}/>
  </div>;
}

// One day's videos as a board: a column per stage. Drag a card to another column, or use its arrows
// (keyboard and touch, where drag and drop doesn't reach).
function DayBoard({ day, items, error, onClose, onStatus, onOpen, onAdd }: { day: string | null; items: PlanItem[]; error: string; onClose: () => void; onStatus: (id: string, status: Status) => void; onOpen: (item: PlanItem) => void; onAdd: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [over, setOver] = useState<Status | null>(null);
  useEffect(() => { if (day) ref.current?.showModal(); else ref.current?.close(); }, [day]);
  return <dialog ref={ref} className="glass project-dialog plan-board-dialog" onClose={onClose} aria-label="Day board">
    {day && <>
      <div className="plan-board-head">
        <div><h2>{dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h2><p className="muted">{items.length ? `${items.length} planned · drag a video to move it to another stage` : 'Nothing planned for this day yet.'}</p></div>
        <div className="toolbar-actions">
          <Button className="primary" onClick={onAdd}><Plus size={16} weight="bold"/>Plan a video</Button>
          <button className="button plan-icon" onClick={onClose} aria-label="Close the board"><X size={16}/></button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="plan-board">
        {STATUSES.map(({ status, label }, i) => {
          const column = items.filter(x => x.status === status);
          return <section key={status} className={`plan-column status-${status} ${over === status ? 'over' : ''}`} aria-label={label}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(status); }} onDragLeave={() => setOver(null)}
            onDrop={e => { e.preventDefault(); setOver(null); onStatus(e.dataTransfer.getData('text/plain'), status); }}>
            <h3><span className="plan-dot" aria-hidden/>{label}<small>{column.length}</small></h3>
            <ul className="plan-cards">{column.map(item => {
              const P = item.platform ? PLATFORMS[item.platform].icon : null;
              return <li key={item.id} className={`plan-board-card status-${item.status}`} draggable onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; }}>
                <button className="plan-board-open" onClick={() => onOpen(item)}>
                  <span className="plan-card-title">{P && <P size={14} aria-label={PLATFORMS[item.platform!].label}/>}<span>{item.title}</span></span>
                  {(item.scheduled_time || item.progress) && <small>{item.scheduled_time?.slice(0, 5)}{item.scheduled_time && item.progress && ' · '}{item.progress && progressLabel(item.progress)}</small>}
                </button>
                <div className="plan-board-moves">
                  <button disabled={i === 0} onClick={() => onStatus(item.id, STATUSES[i - 1].status)} aria-label={i === 0 ? 'Already at the first stage' : `Move “${item.title}” back to ${STATUSES[i - 1].label}`}><CaretLeft size={14}/></button>
                  <button disabled={i === STATUSES.length - 1} onClick={() => onStatus(item.id, STATUSES[i + 1].status)} aria-label={i === STATUSES.length - 1 ? 'Already at the last stage' : `Move “${item.title}” on to ${STATUSES[i + 1].label}`}><CaretRight size={14}/></button>
                </div>
              </li>;
            })}</ul>
          </section>;
        })}
      </div>
    </>}
  </dialog>;
}

function ItemDialog({ editing, onClose, onSaved, onDeleted, onOpenProject }: { editing: Editing; onClose: () => void; onSaved: (item: PlanItem) => void; onDeleted: (id: string) => void; onOpenProject: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [matches, setMatches] = useState<Upload[] | 'failed' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [picker, setPicker] = useState<{ projects: Project[]; linked: Map<string, string> } | null>(null);
  const [choosing, setChoosing] = useState(false); // "Start in Playground" asks which track first
  // Linking or unlinking keeps the dialog open, so it shows the saved item rather than the one it opened with.
  const [live, setLive] = useState<PlanItem | null>(null);
  useEffect(() => { setError(''); setMatches(null); setConfirming(false); setPicker(null); setChoosing(false); setLive(null); if (editing) ref.current?.showModal(); else ref.current?.close(); }, [editing]);
  const item = editing && 'item' in editing ? live ?? editing.item : null;

  async function run(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget), v = (k: string) => String(f.get(k) ?? '').trim() || null;
    const fields = { title: v('title') ?? '', notes: v('notes') ?? '', platform: v('platform'), format: v('format'), status: v('status'), scheduled_on: v('scheduled_on'), scheduled_time: v('scheduled_time') } as PlanFields & { title: string };
    void run(async () => { onSaved(item ? await updateItem(item.id, fields) : await createItem(fields)); onClose(); });
  }
  const startProject = (item: PlanItem, track: Track) => run(async () => {
    const project = await createProject(item.title.slice(0, 80), track);
    onSaved(await updateItem(item.id, { project_id: project.id, status: item.status === 'idea' ? 'scripting' : item.status }));
    onOpenProject(project.id);
  });
  const openPicker = () => run(async () => {
    setChoosing(false);
    const [projects, linked] = await Promise.all([listProjects(), linkedProjects()]);
    setPicker({ projects, linked });
  });
  const link = (item: PlanItem, projectId: string | null) => run(async () => {
    const next = await updateItem(item.id, { project_id: projectId });
    onSaved(next); setLive(next); setPicker(null);
  });
  // Fetches the platform's recent uploads through the existing connectors; nothing is stored but the chosen link.
  // A failed lookup (not connected, quota) still leaves "Mark posted without a link" on offer.
  const findUpload = (item: PlanItem) => run(async () => {
    setMatches(null);
    try {
      const uploads: Upload[] = item.platform === 'youtube'
        ? (await youtubeRequest<YouTubeSnapshot>('sync')).videos.map(v => ({ ...v, url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}` }))
        : (await socialRequest<SocialSnapshot>(item.platform!, 'sync')).videos;
      setMatches(matchCandidates(item, uploads));
    } catch (e) { setMatches('failed'); throw e; }
  });
  const markPosted = (item: PlanItem, upload?: Upload) => run(async () => {
    const url = upload?.url?.startsWith('https://') ? upload.url : null;
    onSaved(await updateItem(item.id, { status: 'posted', post: upload ? { platform: item.platform!, id: upload.id, url, title: upload.title, publishedAt: upload.publishedAt } : null }));
    onClose();
  });

  const defaults = item ?? { title: '', notes: '', platform: null, format: null, status: 'idea', scheduled_on: editing && 'day' in editing ? editing.day : null, scheduled_time: null };
  return <dialog ref={ref} className="glass project-dialog plan-dialog" onClose={onClose}>
    {editing && <form key={item?.id ?? 'new'} onSubmit={submit}>
      <h2>{item ? 'Planned video' : 'Plan a video'}</h2>
      <label>Title<input name="title" required maxLength={140} autoFocus defaultValue={defaults.title} placeholder="e.g. I tried the Goa budget travel hack"/></label>
      <div className="plan-fields">
        <label>Platform<select name="platform" defaultValue={defaults.platform ?? ''}><option value="">Not set</option>{Object.entries(PLATFORMS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
        <label>Format<select name="format" defaultValue={defaults.format ?? ''}><option value="">Not set</option><option value="long">Long-form</option><option value="short">Short-form</option></select></label>
        <label>Day<input type="date" name="scheduled_on" defaultValue={defaults.scheduled_on ?? ''}/></label>
        <label>Time<input type="time" name="scheduled_time" defaultValue={defaults.scheduled_time?.slice(0, 5) ?? ''}/></label>
      </div>
      <label>Status<select name="status" defaultValue={defaults.status}>{STATUSES.map(s => <option key={s.status} value={s.status}>{s.label}</option>)}</select></label>
      <label>Notes<textarea name="notes" rows={3} maxLength={5000} defaultValue={defaults.notes} placeholder="Angle, hook, references…"/></label>
      {!item && <p className="muted plan-hint">Leave the day empty to keep it in the Ideas inbox.</p>}
      {item?.outline
        ? <details className="plan-outline"><summary>Outline <span className="muted">· {new Date(item.outline_at!).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></summary><pre>{item.outline}</pre></details>
        : item?.radar_idea_id && <p className="muted plan-hint">From Trends &amp; News. Ask your Claude or Codex to “outline my planned video {item.title}”, and the outline appears here.</p>}
      {item && <div className="plan-extra">
        {item.project_id
          ? <span className="plan-pair">
            <Button type="button" onClick={() => onOpenProject(item.project_id!)}><Sparkle size={16}/>Open in Playground</Button>
            <button type="button" className="button plan-icon" disabled={busy} onClick={() => void link(item, null)} aria-label="Unlink the Playground project" title="Unlink the Playground project"><LinkBreak size={16}/></button>
          </span>
          : <span className="plan-pair">
            <Button type="button" disabled={busy} aria-expanded={choosing} onClick={() => { setPicker(null); setChoosing(!choosing); }}><Sparkle size={16}/>Start in Playground</Button>
            <button type="button" className={`button plan-icon ${picker ? 'selected' : ''}`} disabled={busy} aria-expanded={!!picker} onClick={() => picker ? setPicker(null) : void openPicker()} aria-label="Link an existing Playground project" title="Link an existing Playground project"><LinkSimple size={16}/></button>
          </span>}
        {item.status === 'posted'
          ? item.post?.url ? <a className="button" href={item.post.url} target="_blank" rel="noreferrer">View post</a>
            : item.platform && <Button type="button" disabled={busy} onClick={() => void findUpload(item)}><CheckCircle size={16}/>Link the upload</Button>
          : item.platform
            ? <Button type="button" disabled={busy} onClick={() => void findUpload(item)}><CheckCircle size={16}/>Mark posted</Button>
            : <Button type="button" disabled={busy} onClick={() => void markPosted(item)}><CheckCircle size={16}/>Mark posted</Button>}
      </div>}
      {item && choosing && !item.project_id && <div className="plan-matches">
        <p className="muted">How will it be made? A project keeps its track.</p>
        <ul>{(Object.keys(TRACKS) as Track[]).map(t => <li key={t}><button type="button" className="plan-match" disabled={busy} onClick={() => void startProject(item, t)}>
          <span><strong>{TRACKS[t].label}</strong><small>{TRACKS[t].blurb}</small></span>
        </button></li>)}</ul>
      </div>}
      {item && picker && <div className="plan-matches">
        <p className="muted">{picker.projects.length ? 'Which project is this video?' : 'You have no Playground projects yet.'}</p>
        {!!picker.projects.length && <ul>{picker.projects.map(p => {
          const taken = picker.linked.get(p.id);
          return <li key={p.id}><button type="button" className="plan-match" disabled={busy || !!taken} onClick={() => void link(item, p.id)}>
            <span><strong>{p.name}</strong><small>{taken ? `Linked to “${taken}”` : `${TRACKS[p.track].label} · ${p.script.trim() ? 'Script written' : 'No script yet'} · Updated ${new Date(p.updated_at).toLocaleDateString()}`}</small></span>
          </button></li>;
        })}</ul>}
      </div>}
      {item && matches && <div className="plan-matches">
        {matches !== 'failed' && <p className="muted">{matches.length ? `Which ${PLATFORMS[item.platform!].label} upload is it?` : `No recent ${PLATFORMS[item.platform!].label} upload from around that day.`}</p>}
        {matches !== 'failed' && !!matches.length && <ul>{matches.map(u => <li key={u.id}><button type="button" className="plan-match" disabled={busy} onClick={() => void markPosted(item, u)}>
          <Thumb src={u.thumbnail} alt="" icon={PLATFORMS[item.platform!].icon} size={20}/>
          <span><strong>{u.title || 'Untitled'}</strong>{u.publishedAt && <small>{new Date(u.publishedAt).toLocaleDateString()}</small>}</span>
        </button></li>)}</ul>}
        {item.status !== 'posted' && <button type="button" className="link-button" disabled={busy} onClick={() => void markPosted(item)}>Mark posted without a link</button>}
      </div>}
      {error && <p role="alert">{error}</p>}
      <div className="toolbar-actions">
        {item && (confirming
          ? <Button type="button" className="danger plan-delete" disabled={busy} onClick={() => void run(async () => { await deleteItem(item.id); onDeleted(item.id); onClose(); })}>Delete for good</Button>
          : <Button type="button" className="plan-delete" onClick={() => setConfirming(true)}>Delete</Button>)}
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button className="primary" type="submit" disabled={busy}>{item ? 'Save' : 'Add to plan'}</Button>
      </div>
    </form>}
  </dialog>;
}
