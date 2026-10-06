import { supabase } from './supabase';

export type Platform = 'youtube' | 'instagram' | 'tiktok';
export type Format = 'long' | 'short';
export type Status = 'idea' | 'scripting' | 'filming' | 'editing' | 'ready' | 'posted';
export const STATUSES: { status: Status; label: string }[] = [
  { status: 'idea', label: 'Idea' }, { status: 'scripting', label: 'Scripting' }, { status: 'filming', label: 'Filming' },
  { status: 'editing', label: 'Editing' }, { status: 'ready', label: 'Ready to post' }, { status: 'posted', label: 'Posted' },
];
// The real upload a posted item was matched to. Only https links are stored (the table checks it too).
export type Post = { platform: Platform; id: string; url: string | null; title: string; publishedAt: string | null };
export type PlanItem = {
  id: string; title: string; notes: string; platform: Platform | null; format: Format | null; status: Status;
  scheduled_on: string | null; scheduled_time: string | null; project_id: string | null; post: Post | null; created_at: string;
  // Linked Playground project's progress, filled in by listPlan.
  progress?: { script: boolean; breakdown: boolean };
};
export type PlanFields = Partial<Pick<PlanItem, 'title' | 'notes' | 'platform' | 'format' | 'status' | 'scheduled_on' | 'scheduled_time' | 'project_id' | 'post'>>;

const COLUMNS = 'id,title,notes,platform,format,status,scheduled_on,scheduled_time,project_id,post,created_at';
function client() { if (!supabase) throw new Error('Sign-in has not been configured for this installation.'); return supabase; }
const now = () => new Date().toISOString();

// Items scheduled between two days (inclusive), plus the whole Ideas inbox.
export async function listPlan(from: string, to: string): Promise<PlanItem[]> {
  const db = client();
  const { data, error } = await db.from('plan_items').select(`${COLUMNS},projects(script)`)
    .or(`scheduled_on.is.null,and(scheduled_on.gte.${from},scheduled_on.lte.${to})`)
    .order('scheduled_time', { ascending: true, nullsFirst: true }).order('created_at', { ascending: false });
  if (error) throw new Error('Could not load your plan.');
  const ids = data.flatMap(i => i.project_id ? [i.project_id] : []);
  const broken = new Set<string>();
  if (ids.length) {
    const { data: jobs } = await db.from('video_jobs').select('project_id').eq('kind', 'breakdown').eq('status', 'done').in('project_id', ids);
    jobs?.forEach(j => broken.add(j.project_id));
  }
  return data.map(({ projects, ...item }) => {
    const project = projects as unknown as { script: string } | null;
    return { ...item, progress: project ? { script: !!project.script.trim(), breakdown: broken.has(item.project_id!) } : undefined } as PlanItem;
  });
}

// Which Playground projects already belong to a planned video (a project links to at most one): project id -> item title.
export async function linkedProjects(): Promise<Map<string, string>> {
  const { data, error } = await client().from('plan_items').select('project_id,title').not('project_id', 'is', null);
  if (error) throw new Error('Could not load your projects.');
  return new Map(data.map(i => [i.project_id as string, i.title]));
}

export async function createItem(fields: PlanFields & { title: string }): Promise<PlanItem> {
  const { data, error } = await client().from('plan_items').insert({ ...fields, title: fields.title.trim() }).select(COLUMNS).single();
  if (error) throw new Error('Could not add this to your plan. Please try again.');
  return data as PlanItem;
}

export async function updateItem(id: string, fields: PlanFields): Promise<PlanItem> {
  const { data, error } = await client().from('plan_items').update({ ...fields, updated_at: now() }).eq('id', id).select(COLUMNS).single();
  if (error) throw new Error('Could not save this item. Please try again.');
  return data as PlanItem;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await client().from('plan_items').delete().eq('id', id);
  if (error) throw new Error('Could not delete this item. Please try again.');
}

// ---- Calendar days. Days are plain 'YYYY-MM-DD' strings; arithmetic runs in UTC so DST never skips one.
const DAY = 86400000;
export const toDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// Six Monday-first weeks covering the month (month is 0-based).
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = addDays(first.toISOString().slice(0, 10), -((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// ---- Matching a posted item to the real upload on a connected platform.
export type Upload = { id: string; title: string; publishedAt: string | null; url: string | null; thumbnail?: string | null };
const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2));

// Uploads published from three days before the planned day onward, best title match first, then
// closest to the planned day. Unscheduled items consider every upload, newest first.
export function matchCandidates(item: Pick<PlanItem, 'title' | 'scheduled_on'>, uploads: Upload[], limit = 8): Upload[] {
  const planned = item.scheduled_on ? Date.parse(`${item.scheduled_on}T00:00:00Z`) : null;
  const want = words(item.title);
  return uploads
    .map(u => ({ u, at: u.publishedAt ? Date.parse(u.publishedAt) : NaN }))
    .filter(({ at }) => planned === null || at >= planned - 3 * DAY)
    .map(({ u, at }) => ({ u, at, score: [...words(u.title)].filter(w => want.has(w)).length }))
    .sort((a, b) => b.score - a.score || (planned === null ? (b.at || 0) - (a.at || 0) : Math.abs(a.at - planned) - Math.abs(b.at - planned)))
    .slice(0, limit).map(x => x.u);
}
