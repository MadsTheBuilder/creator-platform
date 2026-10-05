import { supabase } from './supabase';

export type Project = { id: string; name: string; script: string; updated_at: string };

const COLUMNS = 'id,name,script,updated_at';
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

export async function createProject(name: string): Promise<Project> {
  const { data, error } = await client().from('projects').insert({ name: name.trim() }).select(COLUMNS).single();
  if (error) throw new Error('Could not create the project. Please try again.');
  return data;
}

export async function updateProject(id: string, fields: Partial<Pick<Project, 'name' | 'script'>>): Promise<Project> {
  const { data, error } = await client().from('projects').update({ ...fields, updated_at: now() }).eq('id', id).select(COLUMNS).single();
  if (error) throw new Error('Could not save the project. Please try again.');
  return data;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await client().from('projects').delete().eq('id', id);
  if (error) throw new Error('Could not delete the project. Please try again.');
}
