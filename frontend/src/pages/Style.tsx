import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FolderOpen, Plus, Star, Trash } from '@phosphor-icons/react';
import { useSession, useStyleChanges } from '../data/hooks';
import { byOrder, cardPreview, createStyle, deleteStyle, getStyleFiles, listStyles, readStyleFolder, saveStyleFile, summarise, updateStyle, type Style as StyleRow, type StyleFile } from '../data/styles';
import { Button, Empty, Notice } from '../components/ui';
import { NewStyleDialog } from '../components/NewStyleDialog';

// "03-indian-lawtuber" -> "Indian Lawtuber"
const nameFrom = (folder: string) => folder.replace(/^\d+-/, '').split(/[-_ ]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || 'My style';
const NOTES = 'notes.md';

// The creator's style library: the look their videos are built in. Each Studio project picks one on its Direct step.
export function Style({ onConnections }: { onConnections: () => void }) {
  const session = useSession();
  const [styles, setStyles] = useState<StyleRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [files, setFiles] = useState<StyleFile[] | null>(null);
  const [tab, setTab] = useState(NOTES);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = () => listStyles().then(s => { setStyles(s); setOpen(o => o && s.some(x => x.id === o) ? o : s.find(x => x.is_default)?.id ?? s[0]?.id ?? null); }, e => setError(e.message));
  useEffect(() => { if (session) void reload(); }, [session?.user.id]);
  const loadFiles = (id: string) => getStyleFiles(id).then(setFiles, e => setError(e.message));
  useEffect(() => { setFiles(null); if (open) void loadFiles(open); }, [open]);
  // Saved elsewhere (another tab, the creator's Claude): reload. Unsaved edits here stay in the editor.
  const changes = useStyleChanges(session?.user.id);
  useEffect(() => { if (!changes) return; void reload(); if (open) void loadFiles(open); }, [changes]);
  const file = files?.find(f => f.path === tab);
  // A new file or tab shows its text; a newer version of the same file replaces the editor only without unsaved edits.
  const shown = useRef({ key: '', text: '' });
  useEffect(() => {
    const key = `${open}:${tab}`, text = file?.text ?? '';
    if (shown.current.key !== key || draft === shown.current.text) setDraft(text);
    shown.current = { key, text };
  }, [open, tab, file?.updated_at]);

  if (session === undefined) return <p role="status">Checking your account…</p>;
  if (!session) return <Empty title="Sign in to keep your styles" body="Your styles are saved to your account."><Button className="primary" onClick={onConnections}>Go to sign-in</Button></Empty>;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const importFolder = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!picked.length) return;
    void act(async () => {
      const folder = picked[0].webkitRelativePath.split('/')[0];
      const style = await createStyle(nameFrom(folder), await readStyleFolder(picked), !styles?.length);
      await reload(); setOpen(style.id); setTab(NOTES);
    });
  };

  const style = styles?.find(s => s.id === open);
  const summary = summarise(files?.find(f => f.path === 'style.json')?.text);
  // Files are in reading order (notes.md first); a style without notes yet still gets the tab.
  const tabs = files ? [...(files.some(f => f.path === NOTES) ? [] : [NOTES]), ...files.map(f => f.path)] : [];

  return <div className="storyboard">
    <section className="glass storyboard-form" aria-label="Your styles">
      <div className="section-toolbar">
        <div><h2>Your styles</h2><p className="muted">How your videos look and sound: palette, type, motion, pacing, card templates, voice. Each Studio project picks one; your Claude builds in it and only changes it when you say yes.</p></div>
        <div className="toolbar-actions">
          <Button className="primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden/>Create a new style</Button>
          <label className={`button ${busy ? 'disabled' : ''}`}><FolderOpen size={16}/>Import a style folder
            <input className="sr-only" type="file" {...{ webkitdirectory: '' }} multiple disabled={busy} onChange={importFolder}/></label>
        </div>
      </div>
      {styles === null ? <p role="status">Loading…</p>
        : !styles.length ? <Empty title="No styles yet" body="Import the folder the creator-profile skill made (DESIGN.md, style.json, tokens.css, voice.md, analysis.md, cards/), or ask your Claude to save one with create_style. Reference videos stay on your computer."/>
        : <div className="platform-tabs" role="group" aria-label="Style">{styles.map(s => <button key={s.id} className={s.id === open ? 'active' : ''} aria-pressed={s.id === open} onClick={() => setOpen(s.id)}>{s.name}{s.is_default && ' ★'}</button>)}</div>}
      <NewStyleDialog open={creating} onClose={() => setCreating(false)}/>
    </section>

    {style && <section className="glass storyboard-form" aria-label={style.name}>
      <div className="section-toolbar">
        <label className="style-name">Name<input defaultValue={style.name} key={style.id + style.name} maxLength={80}
          onBlur={e => { const name = e.target.value.trim(); if (name && name !== style.name) void act(async () => { await updateStyle(style.id, { name }); await reload(); }); }}/></label>
        <div className="toolbar-actions">
          {style.is_default ? <span className="muted">Default for new projects</span>
            : <Button disabled={busy} onClick={() => void act(async () => { await updateStyle(style.id, { is_default: true }); await reload(); })}><Star size={16}/>Make default</Button>}
          <Button disabled={busy} aria-label={`Delete ${style.name}`} onClick={() => { if (window.confirm(`Delete the style "${style.name}"? Projects using it will have no style.`)) void act(async () => { await deleteStyle(style.id); await reload(); }); }}><Trash size={16}/></Button>
        </div>
      </div>

      {summary && <div className="style-summary">
        <h3>What your videos are built on</h3>
        {summary.summary && <p>{summary.summary}</p>}
        {summary.palette.length > 0 && <ul className="style-swatches" aria-label="Palette">{summary.palette.map(([k, v]) => <li key={k}><span style={{ background: v }} aria-hidden/>{k} <code>{v}</code></li>)}</ul>}
        {summary.fonts.length > 0 && <p><strong>Type:</strong> {summary.fonts.map(([k, v]) => `${v} (${k})`).join(' · ')}</p>}
        {summary.motion && <p><strong>Motion:</strong> {summary.motion}</p>}
        {summary.transitions && <p><strong>Transitions:</strong> {summary.transitions}</p>}
      </div>}

      {files === null ? <p role="status">Loading the files…</p> : <>
        <div className="platform-tabs style-files" role="group" aria-label="Files">{tabs.map(p => <button key={p} className={p === tab ? 'active' : ''} aria-pressed={p === tab} onClick={() => setTab(p)}>{p === NOTES ? 'Your notes' : p.startsWith('cards/') ? `Card: ${p.split('/').pop()!.replace(/\.html$/, '')}` : p}</button>)}</div>
        {tab === NOTES && <Notice><span>Your own rules (e.g. "captions at least 64px", "never a dark background"). They outrank everything else in the style. Your Claude suggests additions after each video; only the ones you accept land here.</span></Notice>}
        {tab.startsWith('cards/') && <CardPreview card={draft} tokens={files.find(f => f.path === 'tokens.css')?.text}/>}
        <textarea className="style-editor" aria-label={tab} spellCheck={tab.endsWith('.md')} rows={22} value={draft} onChange={e => setDraft(e.target.value)}/>
        <div className="toolbar-actions">
          <Button className="primary" disabled={busy || draft === (file?.text ?? '')}
            onClick={() => void act(async () => { const saved = await saveStyleFile(style.id, tab, draft, file?.updated_at ?? null); setFiles(fs => fs && [...fs.filter(f => f.path !== tab), saved].sort(byOrder)); })}>Save</Button>
          {file && draft !== file.text && <Button disabled={busy} onClick={() => setDraft(file.text)}>Discard changes</Button>}
          {file && <Button disabled={busy} onClick={() => void loadFiles(style.id)}>Reload</Button>}
        </div>
      </>}
    </section>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

// The card playing on a loop with its sample text, in the style's tokens. Sandboxed: scripts run, but the card can't
// reach the site or the creator's session.
function CardPreview({ card, tokens }: { card: string; tokens?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const preview = cardPreview(card, tokens);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / preview.width);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [preview.width]);
  return <figure className="card-preview">
    <div ref={box} className="card-stage" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}>
      <iframe title="Card preview" sandbox="allow-scripts" srcDoc={preview.html} width={preview.width} height={preview.height} style={{ transform: `scale(${scale})` }}/>
    </div>
    <figcaption className="muted">Preview with the card's sample text. In a video, your Claude fills each slot with your words. Edit below to see changes live.</figcaption>
  </figure>;
}
