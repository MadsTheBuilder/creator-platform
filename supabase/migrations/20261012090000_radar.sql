-- Radar: content ideas for a creator and a watchlist that keeps saved ideas up to date.
-- Ported from the topic-radar skill. The worker writes ideas, updates and run results (service role);
-- the creator edits their profile, saves/drops ideas, marks updates seen and asks for a run.
create table public.radar_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  channel_url text not null check (channel_url ~ '^https://(www\.)?youtube\.com/'),
  format text not null default 'both' check (format in ('shorts', 'long', 'both')),
  region text not null default 'IN' check (region ~ '^[A-Z]{2}$'),
  seeds text[] not null default '{}' check (cardinality(seeds) <= 8),
  buckets text[] not null default '{}' check (cardinality(buckets) <= 8),
  -- Filled by the worker from the channel: name, subscribers, recent upload titles (for the "already covered" check).
  channel jsonb,
  updated_at timestamptz not null default now()
);

create table public.radar_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  summary text not null default '',
  angle text not null default '',
  keywords text[] not null default '{}',
  query text not null default '',
  bucket text,
  status text not null default 'new' check (status in ('new', 'saved', 'dropped')),
  label text not null,
  score real not null default 0,
  metrics jsonb not null default '{}',
  evidence jsonb not null default '[]',
  change_note text,
  last_checked timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);
create index radar_ideas_user on public.radar_ideas(user_id, status, score desc);

create table public.radar_updates (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.radar_ideas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('news', 'video', 'document')),
  title text not null,
  url text not null check (url ~ '^https?://'),
  source text,
  published text,
  seen boolean not null default false,
  found_at timestamptz not null default now(),
  unique (idea_id, url)
);
create index radar_updates_idea on public.radar_updates(idea_id, found_at desc);

create table public.radar_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('scan', 'watch')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error text,
  cost_micro integer not null default 0,
  summary jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
-- One waiting or running run of each kind per creator, so a double click cannot pay twice.
create unique index radar_runs_one_active on public.radar_runs(user_id, kind) where status in ('queued', 'running');
create index radar_runs_recent on public.radar_runs(user_id, created_at desc);

alter table public.radar_profiles enable row level security;
alter table public.radar_ideas enable row level security;
alter table public.radar_updates enable row level security;
alter table public.radar_runs enable row level security;
revoke all on public.radar_profiles, public.radar_ideas, public.radar_updates, public.radar_runs from public, anon, authenticated;
grant select, insert, update, delete on public.radar_profiles, public.radar_ideas, public.radar_updates, public.radar_runs to service_role;
grant select on public.radar_profiles, public.radar_ideas, public.radar_updates, public.radar_runs to authenticated;
grant insert (channel_url, format, region, seeds, buckets) on public.radar_profiles to authenticated;
grant update (channel_url, format, region, seeds, buckets, updated_at) on public.radar_profiles to authenticated;
grant update (status, updated_at) on public.radar_ideas to authenticated;
grant update (seen) on public.radar_updates to authenticated;
grant insert (kind) on public.radar_runs to authenticated;
create policy "read own radar profile" on public.radar_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "add own radar profile" on public.radar_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "edit own radar profile" on public.radar_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "read own ideas" on public.radar_ideas for select to authenticated using (user_id = (select auth.uid()));
create policy "decide own ideas" on public.radar_ideas for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "read own updates" on public.radar_updates for select to authenticated using (user_id = (select auth.uid()));
create policy "mark own updates" on public.radar_updates for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "read own radar runs" on public.radar_runs for select to authenticated using (user_id = (select auth.uid()));
create policy "ask for a radar run" on public.radar_runs for insert to authenticated with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.radar_ideas, public.radar_updates, public.radar_runs;
