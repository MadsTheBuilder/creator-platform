// A project's creator style, copied into its folder as style/ so the composition can mount the style's cards:
//   <div id="stat-1" data-composition-id="stat-1" data-composition-src="style/cards/tier1/t1-stat-redtear.html"
//        data-start="23.6" data-duration="5" data-track-index="3" data-variable-values='{"stat":"10 MIN"}'></div>
// Cards are stored as the creator-profile kit writes them (standalone, slot text inline, GSAP from a CDN);
// mountable() turns each into a HyperFrames sub-composition whose data-slot text comes from data-variable-values.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

const SLOT = /<(\w+)\b[^>]*\bdata-slot="([a-z0-9_-]+)"[^>]*>([^<]*)</g;

export const cardSlots = (html: string) => [...html.matchAll(SLOT)].map(m => ({ id: m[2], default: m[3].trim() }));

export function mountable(html: string) {
  const vars = JSON.stringify(cardSlots(html).map(s => ({ id: s.id, type: 'string', label: s.id, default: s.default }))).replace(/'/g, '&#39;');
  // Fill each slot from the mount's variables before the card's own script runs (it may split the text into lines).
  const fill = `<script>(()=>{const v=(window.__hyperframes&&window.__hyperframes.getVariables&&window.__hyperframes.getVariables())||{};`
    + `document.querySelectorAll('[data-slot]').forEach(el=>{const t=v[el.dataset.slot];if(typeof t!=='string'||!t)return;`
    + `if(el.dataset.slot==='image')el.style.backgroundImage='url("'+t.replace(/["\\\\]/g,'')+'")';else el.textContent=t;});})();</script>`;
  // The kit's cards use tight, deliberate leading that hyperframes check reads as overlapping text; the waiver goes on
  // the slot text itself (including lines a card script splits out), never on a parent.
  const waive = `<script>document.querySelectorAll('[data-slot],[data-slot] *').forEach(el=>el.setAttribute('data-layout-allow-overlap',''));</script>`;
  let out = html.replace(/<html\b([^>]*)>/i, (_m, attrs) => `<html${attrs.replace(/\sdata-composition-variables='[^']*'/, '')} data-composition-variables='${vars}'>`);
  // GSAP from the project folder (style/cards/<tier>/card.html -> ../../../gsap.min.js), never a CDN.
  const gsap = /<script\b[^>]*\bsrc="[^"]*gsap[^"]*"[^>]*><\/script>/i;
  out = gsap.test(out) ? out.replace(gsap, `<script src="../../../gsap.min.js"></script>${fill}`) : out.replace(/<body\b[^>]*>/i, m => `${m}<script src="../../../gsap.min.js"></script>${fill}`);
  return out.replace(/<\/body>/i, `${waive}</body>`);
}

// Writes style/tokens.css and style/cards/** for the project's style (or removes style/ when it has none).
export async function syncStyle(db: SupabaseClient, user: string, projectId: string, dir: string) {
  const root = join(dir, 'style');
  const { data: project } = await db.from('projects').select('style_id').eq('id', projectId).eq('user_id', user).maybeSingle();
  if (!project?.style_id) { await rm(root, { recursive: true, force: true }); return null; }
  const { data, error } = await db.from('creator_style_files').select('path,text').eq('style_id', project.style_id).eq('user_id', user);
  if (error) throw error;
  const wanted = new Map<string, string>();
  for (const f of (data ?? []) as { path: string; text: string }[]) {
    if (f.path === 'tokens.css') wanted.set(f.path, f.text);
    else if (f.path.startsWith('cards/')) wanted.set(f.path, mountable(f.text));
  }
  const existing = await list(root);
  for (const path of existing) if (!wanted.has(path)) await rm(join(root, path), { force: true });
  for (const [path, text] of wanted) {
    const file = join(root, path);
    if (await readFile(file, 'utf8').catch(() => null) === text) continue;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return [...wanted.keys()].filter(p => p.startsWith('cards/')).map(p => `style/${p}`);
}

async function list(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter(e => e.isFile()).map(e => relative(root, join(e.parentPath, e.name)).replaceAll('\\', '/'));
}
