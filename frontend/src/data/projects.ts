import { supabase } from './supabase';
import type { Track } from './tracks';

// direction and beat_plan belong to the Studio track (the beat plan is written by the creator's Claude over MCP, and
// the creator can edit it). style_id is the creator style the project is built in (data/styles.ts).
export type Project = { id: string; name: string; track: Track; script: string; direction: string; beat_plan: string; style_id: string | null; updated_at: string };

const COLUMNS = 'id,name,track,script,direction,beat_plan,style_id,updated_at';
function client() { if (!supabase) throw new Error('Sign-in has not been configured for this installation.'); return supabase; }
const now = () => new Date().toISOString();

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await client().from('projects').select(COLUMNS).order('updated_at', { ascending: false });
  if (error) throw new Error('Could not load your projects.');
  return data;
}

export async function getProject(id: string): Promise<Project> {
  const { data, error } = await client().from('projects').select(COLUMNS).eq('id', id).single();
  if (error) throw new Error('Could not open this project.');
  return data;
}

export async function createProject(name: string, track: Track): Promise<Project> {
  // New projects are built in the creator's default style; they can pick another on the Direct step.
  const { data: style } = await client().from('creator_styles').select('id').eq('is_default', true).maybeSingle();
  const { data, error } = await client().from('projects').insert({ name: name.trim(), track, style_id: style?.id ?? null }).select(COLUMNS).single();
  if (error) throw new Error('Could not create the project. Please try again.');
  return data;
}

export async function updateProject(id: string, fields: Partial<Pick<Project, 'name' | 'script' | 'direction' | 'beat_plan' | 'style_id'>>): Promise<Project> {
  const { data, error } = await client().from('projects').update({ ...fields, updated_at: now() }).eq('id', id).select(COLUMNS).single();
  if (error) throw new Error('Could not save the project. Please try again.');
  return data;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await client().from('projects').delete().eq('id', id);
  if (error) throw new Error('Could not delete the project. Please try again.');
}
