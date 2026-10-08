// The shared guest account: one Supabase user, marked app_metadata.guest, that the #guest link signs visitors into
// (POST /api/guest in server.ts). `node guest.ts reset` wipes it and fills it with a copy of GUEST_SOURCE_USER's
// projects, plan, Radar and styles, rows and files. Run it where the /data volume is: `railway ssh --service worker`.
// Never copied: YouTube / Instagram / TikTok connections and paired computers.
import { randomUUID } from 'node:crypto';
import { cp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DATA, projectDir } from './project-files.ts';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TEXT = new Set(['.json', '.html', '.htm', '.md', '.txt', '.css', '.js', '.mjs', '.srt', '.vtt']);
type Row = Record<string, unknown>;

// Every id that appears anywhere in a copied row or file (keys, jsonb, paths) points at the copy.
export const remapIds = (text: string, ids: Map<string, string>) => text.replace(UUID, id => ids.get(id) ?? id);

// The copied rows, in insert order, with new ids. A job or run caught mid-flight lands as failed, so nothing picks it up.
export function copyRows(tables: Record<string, Row[]>, from: string, to: string) {
  const ids = new Map([[from, to]]);
  for (const rows of Object.values(tables)) for (const row of rows) if (typeof row.id === 'string') ids.set(row.id, randomUUID());
  const out: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(tables)) out[table] = rows.map(row => {
    const copy = JSON.parse(remapIds(JSON.stringify(row), ids)) as Row;
    if ((table === 'video_jobs' || table === 'radar_runs') && (copy.status === 'queued' || copy.status === 'running')) {
      copy.status = 'failed'; copy.error = 'Stopped when the guest account was copied.';
    }
    return copy;
  });
  return { rows: out, ids };
}

// Parents before children. Deleting the guest's rows in reverse cascades the rest.
const TABLES = ['creator_styles', 'creator_style_files', 'projects', 'video_jobs', 'radar_profiles', 'radar_runs', 'radar_ideas',
  'radar_updates', 'radar_reviews', 'radar_ai_steps', 'plan_items'];
const PRIVATE = ['youtube_connections', 'youtube_oauth_states', 'social_connections', 'social_oauth_states', 'bridge_devices'];

async function all(db: SupabaseClient, table: string, user: string) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select('*').eq('user_id', user).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function guestUser(db: SupabaseClient, email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (user) {
      if (user.app_metadata?.guest !== true) throw new Error(`${email} is a real account, not the guest. Pick another GUEST_EMAIL.`);
      return user.id;
    }
    if (data.users.length < 1000) break;
  }
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, app_metadata: { guest: true }, user_metadata: { full_name: 'Guest' } });
  if (error) throw error;
  return data.user.id;
}

// A session for the guest, from a one-time sign-in link the server redeems itself: the guest has no password.
export async function guestSession(db: SupabaseClient, email: string) {
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  if (data.user.app_metadata?.guest !== true) throw new Error(`${email} is not the guest account`);
  const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signed, error: verifyError } = await auth.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' });
  if (verifyError || !signed.session) throw verifyError ?? new Error('no session');
  return { access_token: signed.session.access_token, refresh_token: signed.session.refresh_token };
}

async function remapFiles(dir: string, ids: Map<string, string>) {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !TEXT.has(extname(entry.name).toLowerCase())) continue;
    const path = join(entry.parentPath, entry.name), text = await readFile(path, 'utf8'), next = remapIds(text, ids);
    if (next !== text) await writeFile(path, next);
  }
}

export async function resetGuest(db: SupabaseClient, source: string, email: string, log = console.log) {
  const guest = await guestUser(db, email);
  if (guest === source) throw new Error('GUEST_SOURCE_USER is the guest account itself.');

  log(`wiping guest ${guest}`);
  for (const table of [...TABLES].reverse().concat(PRIVATE)) {
    const { error } = await db.from(table).delete().eq('user_id', guest);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  await rm(join(DATA, 'projects', guest), { recursive: true, force: true });
  const renders = db.storage.from('renders');
  const { data: oldRenders } = await renders.list(guest, { limit: 1000 });
  if (oldRenders?.length) await renders.remove(oldRenders.map(f => `${guest}/${f.name}`));

  const tables: Record<string, Row[]> = {};
  for (const table of TABLES) tables[table] = await all(db, table, source);
  const { rows, ids } = copyRows(tables, source, guest);
  for (const table of TABLES) {
    for (let i = 0; i < rows[table].length; i += 500) {
      const { error } = await db.from(table).insert(rows[table].slice(i, i + 500));
      if (error) throw new Error(`${table}: ${error.message}`);
    }
    log(`${table}: ${rows[table].length}`);
  }

  for (const project of tables.projects) {
    const from = projectDir(source, project.id as string), to = projectDir(guest, ids.get(project.id as string)!);
    if (!await stat(from).catch(() => null)) continue;
    await cp(from, to, { recursive: true });
    const blockouts = join(to, 'blockout');
    for (const job of await readdir(blockouts).catch(() => [])) if (ids.has(job)) await rename(join(blockouts, job), join(blockouts, ids.get(job)!));
    await remapFiles(to, ids);
  }
  log(`files: ${tables.projects.length} projects`);

  const { data: sourceRenders } = await renders.list(source, { limit: 1000 });
  for (const f of sourceRenders ?? []) {
    const name = remapIds(f.name, ids);
    if (name !== f.name) await renders.copy(`${source}/${f.name}`, `${guest}/${name}`);
  }
  log('done');
  return guest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY, GUEST_EMAIL, GUEST_SOURCE_USER } = process.env;
  if (process.argv[2] !== 'reset' || !SUPABASE_URL || !SUPABASE_SECRET_KEY || !GUEST_EMAIL || !GUEST_SOURCE_USER) {
    console.error('Usage: node guest.ts reset  (needs SUPABASE_URL, SUPABASE_SECRET_KEY, GUEST_EMAIL, GUEST_SOURCE_USER)');
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await resetGuest(db, GUEST_SOURCE_USER, GUEST_EMAIL);
}
