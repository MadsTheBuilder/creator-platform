-- A shared account is readable by anyone who opens the site without signing in (the anon role): its projects,
-- plan, Radar and styles, never its connections, OAuth states or paired computers. Read only: anon gets SELECT and
-- nothing else. Share an account by inserting its user id; stop sharing by deleting the row.
create table public.shared_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.shared_accounts enable row level security;
grant select on public.shared_accounts to anon;
create policy "anyone sees which account is shared" on public.shared_accounts for select to anon using (true);

do $$
declare t text;
begin
  foreach t in array array['projects','video_jobs','plan_items','creator_styles','creator_style_files',
    'radar_profiles','radar_runs','radar_ideas','radar_updates','radar_reviews','radar_ai_steps'] loop
    execute format('grant select on public.%I to anon', t);
    execute format('create policy "read shared account" on public.%I for select to anon using (user_id in (select user_id from public.shared_accounts))', t);
  end loop;
end $$;
