-- Planner: the creator's videos on a calendar. An item with no day sits in the Ideas inbox.
-- The day is a plain date (the creator's own calendar day), so it never shifts between time zones.
-- A posted item can carry the real upload it was matched to on a connected platform.
create table public.plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 140),
  notes text not null default '' check (char_length(notes) <= 5000),
  platform text check (platform in ('youtube','instagram','tiktok')),
  format text check (format in ('long','short')),
  status text not null default 'idea' check (status in ('idea','scripting','filming','editing','ready','posted')),
  scheduled_on date,
  scheduled_time time,
  project_id uuid unique references public.projects(id) on delete set null,
  post jsonb check (post is null or (octet_length(post::text) < 4000 and coalesce(post->>'url','https://') like 'https://%')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plan_items_user on public.plan_items(user_id, scheduled_on);
alter table public.plan_items enable row level security;
revoke all on public.plan_items from public, anon, authenticated;
grant select, insert, delete on public.plan_items to authenticated;
grant update (title, notes, platform, format, status, scheduled_on, scheduled_time, project_id, post, updated_at) on public.plan_items to authenticated;
grant select, insert, update, delete on public.plan_items to service_role;
create policy "read own plan" on public.plan_items for select to authenticated using (user_id = (select auth.uid()));
create policy "add to own plan" on public.plan_items for insert to authenticated
  with check (user_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))));
create policy "edit own plan" on public.plan_items for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))));
create policy "delete own plan" on public.plan_items for delete to authenticated using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.plan_items;
