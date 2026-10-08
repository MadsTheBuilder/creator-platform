import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Written by the worker's radar loop (worker/radar.ts); the creator only edits their profile,
// saves or drops ideas, marks updates seen and asks for a run.
export type RadarProfile = { channel_url: string; format: 'shorts' | 'long' | 'both'; region: string; seeds: string[]; buckets: string[]; channel: { name: string; subs: number } | null };
export type Evidence = { kind: 'video' | 'news' | 'document'; title: string; url: string; source: string; date: string; views?: number; x?: number | null };
export type Metrics = { breakout: number; peer_videos: number; slope: number | null; sat: number; uploads_14d: number; covered_by: string | null; newest_days: number | null };
export type Idea = { id: string; name: string; summary: string; angle: string; bucket: string | null; status: 'new' | 'saved' | 'dropped' | 'archived'; label: string; score: number;
  metrics: Metrics; evidence: Evidence[]; change_note: string | null; last_checked: string | null; created_at: string };
export type Update = { id: string; idea_id: string; kind: Evidence['kind']; title: string; url: string; source: string | null; published: string | null; seen: boolean; found_at: string };
export type Run = { id: string; kind: 'scan' | 'watch'; status: 'queued' | 'running' | 'done' | 'failed'; error: string | null; summary: { ideas?: number } | null; created_at: string; finished_at: string | null };
// An independent check of an idea by the creator's own Claude or Codex over MCP (review_radar_idea). Advice only.
export type Review = { id: string; idea_id: string; reviewer: 'claude' | 'codex' | 'other'; model: string | null; verdict: 'keep' | 'fix' | 'drop'; notes: string;
  suggestion: { name?: string; summary?: string; angle?: string }; created_at: string };
export type Radar = { profile: RadarProfile | null; ideas: Idea[]; updates: Update[]; runs: Run[]; reviews: Review[] };

function client() { if (!supabase) throw new Error('Sign-in has not been configured for this installation.'); return supabase; }

export async function loadRadar(): Promise<Radar> {
  const db = client();
  const [profile, ideas, updates, runs, reviews] = await Promise.all([
    db.from('radar_profiles').select('channel_url,format,region,seeds,buckets,channel').maybeSingle(),
    db.from('radar_ideas').select('id,name,summary,angle,bucket,status,label,score,metrics,evidence,change_note,last_checked,created_at').neq('status', 'dropped').order('score', { ascending: false }),
    db.from('radar_updates').select('id,idea_id,kind,title,url,source,published,seen,found_at').order('found_at', { ascending: false }).limit(300),
    db.from('radar_runs').select('id,kind,status,error,summary,created_at,finished_at').order('created_at', { ascending: false }).limit(10),
    db.from('radar_reviews').select('id,idea_id,reviewer,model,verdict,notes,suggestion,created_at').order('created_at', { ascending: false }).limit(200),
  ]);
  const error = profile.error ?? ideas.error ?? updates.error ?? runs.error ?? reviews.error;
  if (error) throw new Error('Could not load your ideas.');
  return { profile: profile.data as RadarProfile | null, ideas: ideas.data as Idea[], updates: updates.data as Update[], runs: runs.data as Run[], reviews: reviews.data as Review[] };
}

export async function saveProfile(fields: Omit<RadarProfile, 'channel'>, exists: boolean) {
  const db = client().from('radar_profiles');
  const { error } = exists ? await db.update({ ...fields, updated_at: new Date().toISOString() }).not('user_id', 'is', null) : await db.insert(fields);
  if (error) throw new Error(/check/.test(error.message) ? 'Use a channel link like https://www.youtube.com/@handle and at most 8 topics.' : 'Could not save your channel.');
}

export async function decide(id: string, status: Idea['status']) {
  const { error } = await client().from('radar_ideas').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error('Could not save this decision. Please try again.');
}

// Only archived ideas can be deleted (RLS), so a stray click on a live idea cannot lose it.
export async function deleteIdea(id: string) {
  const { error } = await client().from('radar_ideas').delete().eq('id', id).eq('status', 'archived');
  if (error) throw new Error('Could not delete this idea. Please try again.');
}

export async function markSeen(ids: string[]) {
  if (!ids.length) return;
  const { error } = await client().from('radar_updates').update({ seen: true }).in('id', ids);
  if (error) throw new Error('Could not mark these as read.');
}

export async function requestRun(kind: Run['kind']) {
  const { error } = await client().from('radar_runs').insert({ kind });
  if (error) throw new Error(error.code === '23505' ? 'That is already running.' : 'Could not start it. Please try again.');
}

// Counts changes the worker makes, so the page reloads when a scan or check finishes.
export function useRadarChanges(userId: string | undefined) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!supabase || !userId) return;
    const bump = () => setVersion(v => v + 1);
    const channel = supabase.channel(`radar-${userId}-${crypto.randomUUID()}`);
    for (const table of ['radar_ideas', 'radar_updates', 'radar_runs', 'radar_reviews']) channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, bump);
    channel.subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [userId]);
  return version;
}
