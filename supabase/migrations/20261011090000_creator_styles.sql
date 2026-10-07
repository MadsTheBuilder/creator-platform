-- Creator styles: the editing look a creator's videos are built in (the creator-profile skill's files:
-- DESIGN.md, voice.md, analysis.md, style.json, tokens.css, the creator's own notes.md, and HTML card templates).
-- An account keeps a library of styles; each project picks one (or none). The creator reads and edits them on
-- the site; their Claude reads them over MCP and saves only the edits the creator accepted.
-- Kept in Postgres rather than the app volume, which has no backup.
create table public.creator_styles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index creator_styles_user on public.creator_styles(user_id, updated_at desc);
create unique index creator_styles_one_default on public.creator_styles(user_id) where is_default;

create table public.creator_style_files (
  style_id uuid not null,
  user_id uuid not null default auth.uid(),
  path text not null check (path ~ '^(DESIGN\.md|voice\.md|analysis\.md|style\.json|tokens\.css|notes\.md|cards/[a-z0-9-]{1,40}/[a-z0-9-]{1,60}\.html)$'),
  text text not null check (octet_length(text) <= 262144),
  updated_at timestamptz not null default now(),
  primary key (style_id, path),
  foreign key (style_id, user_id) references public.creator_styles(id, user_id) on delete cascade
);

-- The project's style. The composite key means a project can only point at its own creator's style.
alter table public.projects add column style_id uuid;
alter table public.projects add constraint projects_style_fk foreign key (style_id, user_id)
  references public.creator_styles(id, user_id) on delete set null (style_id);

alter table public.creator_styles enable row level security;
alter table public.creator_style_files enable row level security;
revoke all on public.creator_styles, public.creator_style_files from public, anon, authenticated;
grant select, insert, delete on public.creator_styles, public.creator_style_files to authenticated;
grant update (name, is_default, updated_at) on public.creator_styles to authenticated;
grant update (text, updated_at) on public.creator_style_files to authenticated;
grant select, insert, update, delete on public.creator_styles, public.creator_style_files to service_role;
create policy "read own styles" on public.creator_styles for select to authenticated using (user_id = (select auth.uid()));
create policy "add own styles" on public.creator_styles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "edit own styles" on public.creator_styles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own styles" on public.creator_styles for delete to authenticated using (user_id = (select auth.uid()));
create policy "read own style files" on public.creator_style_files for select to authenticated using (user_id = (select auth.uid()));
create policy "add own style files" on public.creator_style_files for insert to authenticated with check (user_id = (select auth.uid()));
create policy "edit own style files" on public.creator_style_files for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own style files" on public.creator_style_files for delete to authenticated using (user_id = (select auth.uid()));

-- The creator picks a project's style and can now edit the beat plan (the project brief) themselves.
grant update (style_id, beat_plan) on public.projects to authenticated;

alter publication supabase_realtime add table public.creator_styles, public.creator_style_files;
