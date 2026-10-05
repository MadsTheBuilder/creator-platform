-- Playground projects. Each project holds a script, its jobs, and (on the app server's volume)
-- a HyperFrames project folder at /data/projects/<user_id>/<id>.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  script text not null default '' check (char_length(script) <= 60000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user on public.projects(user_id, updated_at desc);
alter table public.projects enable row level security;
revoke all on public.projects from public, anon, authenticated;
grant select, insert, delete on public.projects to authenticated;
grant update (name, script, updated_at) on public.projects to authenticated;
grant select, insert, update, delete on public.projects to service_role;
create policy "read own projects" on public.projects for select to authenticated using (user_id = (select auth.uid()));
create policy "create own projects" on public.projects for insert to authenticated with check (user_id = (select auth.uid()));
create policy "edit own projects" on public.projects for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own projects" on public.projects for delete to authenticated using (user_id = (select auth.uid()));

-- Jobs belong to a project (older storyboard jobs have none). New kinds: script generation and
-- Blender blockouts (claimed by the creator's own PC, not the server loop). 'render' stays valid for
-- old rows only: exports now happen in the HyperFrames Studio editor.
alter table public.video_jobs add column project_id uuid references public.projects(id) on delete cascade;
create index video_jobs_project on public.video_jobs(project_id, created_at desc);
alter table public.video_jobs drop constraint video_jobs_kind_check;
alter table public.video_jobs add constraint video_jobs_kind_check check (kind in ('breakdown','render','script','blockout'));
drop policy "queue own jobs" on public.video_jobs;
create policy "queue own jobs" on public.video_jobs for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'queued' and output is null and error is null
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))));

-- The server loop only claims the kinds it runs; the Blender bridge claims one creator's blockouts.
drop function public.claim_video_job();
create function public.claim_video_job(p_kinds text[] default array['breakdown','script'], p_user uuid default null)
returns setof public.video_jobs language sql security invoker set search_path = '' as $$
  update public.video_jobs set status = 'running', updated_at = now()
  where id = (select id from public.video_jobs
    where status = 'queued' and kind = any(p_kinds) and (p_user is null or user_id = p_user)
    order by created_at for update skip locked limit 1)
  returning *;
$$;
revoke all on function public.claim_video_job(text[], uuid) from public, anon, authenticated;
grant execute on function public.claim_video_job(text[], uuid) to service_role;

-- Creator PCs paired to run Blender blockouts. Only the app server reads or writes these; the
-- browser never sees a token (the helper download carries it, and only its hash is stored).
create table public.bridge_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  name text not null default 'Blender PC',
  created_at timestamptz not null default now(),
  last_seen timestamptz
);
create index bridge_devices_user on public.bridge_devices(user_id);
alter table public.bridge_devices enable row level security;
revoke all on public.bridge_devices from public, anon, authenticated;
grant select, insert, update, delete on public.bridge_devices to service_role;
