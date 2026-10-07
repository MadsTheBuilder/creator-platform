import { supabase } from './supabase';

// Creator styles: the look a creator's videos are built in (the creator-profile skill's files). The creator reads
// and edits them here; their Claude reads them over MCP and saves only the edits the creator accepted.
export type Style = { id: string; name: string; is_default: boolean; updated_at: string };
export type StyleFile = { path: string; text: string; updated_at: string };

// The same paths the database allows (creator_style_files.path).
export const STYLE_PATH = /^(DESIGN\.md|voice\.md|analysis\.md|style\.json|tokens\.css|notes\.md|cards\/[a-z0-9-]{1,40}\/[a-z0-9-]{1,60}\.html)$/;
const MAX_BYTES = 262144;
// Reading order on the page: the creator's own rules first.
export const FILE_ORDER = ['notes.md', 'DESIGN.md', 'style.json', 'tokens.css', 'voice.md', 'analysis.md'];
export const byOrder = (a: StyleFile, b: StyleFile) => {
  const i = (p: string) => { const n = FILE_ORDER.indexOf(p); return n < 0 ? FILE_ORDER.length : n; };
  return i(a.path) - i(b.path) || a.path.localeCompare(b.path);
};

function client() { if (!supabase) throw new Error('Sign-in has not been configured for this installation.'); return supabase; }
const now = () => new Date().toISOString();

export async function listStyles(): Promise<Style[]> {
  const { data, error } = await client().from('creator_styles').select('id,name,is_default,updated_at').order('updated_at', { ascending: false });
  if (error) throw new Error('Could not load your styles.');
  return data;
}

export async function getStyleFiles(id: string): Promise<StyleFile[]> {
  const { data, error } = await client().from('creator_style_files').select('path,text,updated_at').eq('style_id', id);
  if (error) throw new Error('Could not load this style.');
  return data.sort(byOrder);
}

// A folder picked with <input webkitdirectory>: keep only the files a style holds, by their path inside the folder.
export async function readStyleFolder(files: File[]) {
  const picked: { path: string; text: string }[] = [];
  for (const file of files) {
    const path = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
    if (!STYLE_PATH.test(path)) continue;
    if (file.size > MAX_BYTES) throw new Error(`${path} is over 256 KB.`);
    picked.push({ path, text: await file.text() });
  }
  if (!picked.length) throw new Error('No style files found. Pick the folder that holds DESIGN.md, style.json, tokens.css, voice.md and analysis.md.');
  return picked;
}

export async function createStyle(name: string, files: { path: string; text: string }[], makeDefault: boolean): Promise<Style> {
  if (makeDefault) await clearDefault();
  const { data: style, error } = await client().from('creator_styles').insert({ name: name.trim(), is_default: makeDefault }).select('id,name,is_default,updated_at').single();
  if (error) throw new Error('Could not create the style. Please try again.');
  const { error: filesError } = await client().from('creator_style_files').insert(files.map(f => ({ style_id: style.id, ...f })));
  if (filesError) { await client().from('creator_styles').delete().eq('id', style.id); throw new Error('Could not save the style files. Please try again.'); }
  return style;
}

async function clearDefault() {
  const { error } = await client().from('creator_styles').update({ is_default: false }).eq('is_default', true);
  if (error) throw new Error('Could not change the default style.');
}

export async function updateStyle(id: string, fields: Partial<Pick<Style, 'name' | 'is_default'>>) {
  if (fields.is_default) await clearDefault();
  const { error } = await client().from('creator_styles').update({ ...fields, updated_at: now() }).eq('id', id);
  if (error) throw new Error('Could not save the style. Please try again.');
}

export async function deleteStyle(id: string) {
  const { error } = await client().from('creator_styles').delete().eq('id', id);
  if (error) throw new Error('Could not delete the style. Please try again.');
}

// Saves only over the version that was loaded, so an edit the creator's Claude saved meanwhile is never lost.
export async function saveStyleFile(id: string, path: string, text: string, loaded: string | null): Promise<StyleFile> {
  if (new Blob([text]).size > MAX_BYTES) throw new Error('A style file can be at most 256 KB.');
  const row = { text, updated_at: now() };
  const { data, error } = loaded
    ? await client().from('creator_style_files').update(row).eq('style_id', id).eq('path', path).eq('updated_at', loaded).select('path,text,updated_at')
    : await client().from('creator_style_files').insert({ style_id: id, path, ...row }).select('path,text,updated_at');
  if (error?.code === '23505' || (!error && !data?.length)) throw new Error(`${path} changed since you opened it. Reload the style, then apply your edit again.`);
  if (error) throw new Error('Could not save the file. Please try again.');
  await client().from('creator_styles').update({ updated_at: row.updated_at }).eq('id', id);
  return data[0];
}

// The readable summary: what the design is based on, from style.json.
export type StyleSummary = { summary?: string; palette: [string, string][]; fonts: [string, string][]; motion?: string; transitions?: string };
export function summarise(styleJson: string | undefined): StyleSummary | null {
  if (!styleJson) return null;
  try {
    const s = JSON.parse(styleJson);
    const strings = (o: unknown) => Object.entries(o && typeof o === 'object' ? o : {}).filter((e): e is [string, string] => typeof e[1] === 'string');
    return {
      summary: typeof s.summary === 'string' ? s.summary : undefined,
      palette: strings(s.palette).filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(v)),
      fonts: strings(s.fonts),
      motion: typeof s.motion === 'string' ? s.motion : undefined,
      transitions: typeof s.transitions === 'string' ? s.transitions : undefined,
    };
  } catch { return null; }
}

// A card as a looping preview for a sandboxed iframe: the style's tokens inlined, its timeline played on repeat.
export function cardPreview(card: string, tokens = '') {
  const play = `<style>:root{color-scheme:dark}html,body{overflow:hidden;background:transparent}</style><script>addEventListener('load',()=>{for(const t of Object.values(window.__timelines||{})){t.repeat(-1).repeatDelay(0.8);t.play(0);}});</script>`;
  const size = card.match(/data-width="(\d+)"[^>]*data-height="(\d+)"/);
  const html = card.replace(/<link\b[^>]*href="[^"]*tokens\.css"[^>]*>/i, () => `<style>${tokens.replace(/<\/style/gi, '<\/style')}</style>`);
  return { html: /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${play}</body>`) : html + play, width: Number(size?.[1] ?? 1920), height: Number(size?.[2] ?? 1080) };
}
