-- Queue for the Railway video worker. Creators insert queued jobs and read their own;
-- only the worker (service_role) claims and finishes them.
create table public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('breakdown','render')),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  input jsonb not null check (octet_length(input::text) < 200000),
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index video_jobs_queue on public.video_jobs(created_at) where status = 'queued';
create index video_jobs_user on public.video_jobs(user_id, created_at desc);
alter table public.video_jobs enable row level security;
revoke all on public.video_jobs from public, anon, authenticated;
grant select, insert on public.video_jobs to authenticated;
grant select, insert, update, delete on public.video_jobs to service_role;
create policy "read own jobs" on public.video_jobs for select to authenticated using (user_id = (select auth.uid()));
create policy "queue own jobs" on public.video_jobs for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'queued' and output is null and error is null);

-- Worker: take the oldest queued job; skip locked rows so several workers never share one.
create function public.claim_video_job()
returns setof public.video_jobs language sql security invoker set search_path = '' as $$
  update public.video_jobs set status = 'running', updated_at = now()
  where id = (select id from public.video_jobs where status = 'queued' order by created_at for update skip locked limit 1)
  returning *;
$$;
revoke all on function public.claim_video_job() from public, anon, authenticated;
grant execute on function public.claim_video_job() to service_role;

-- Rendered MP4s live at renders/<user_id>/<job_id>.mp4. Creators can only read their own folder.
insert into storage.buckets (id, name, public) values ('renders', 'renders', false) on conflict (id) do nothing;
create policy "read own renders" on storage.objects for select to authenticated
  using (bucket_id = 'renders' and (storage.foldername(name))[1] = (select auth.uid())::text);
