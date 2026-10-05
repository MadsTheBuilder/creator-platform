begin;
create table if not exists public.youtube_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credentials text not null,
  channel_id text not null,
  channel_title text not null,
  connected_at timestamptz not null default now()
);
create table if not exists public.youtube_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verifier text not null,
  origin text not null,
  expires_at timestamptz not null
);
create index if not exists youtube_oauth_states_expiry on public.youtube_oauth_states(expires_at);
alter table public.youtube_connections enable row level security;
alter table public.youtube_oauth_states enable row level security;
revoke all on public.youtube_connections, public.youtube_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.youtube_connections, public.youtube_oauth_states to service_role;
-- Atomic consumption prevents parallel callbacks and replay. Invoker privileges only.
create or replace function public.consume_youtube_state(p_hash text)
returns setof public.youtube_oauth_states
language sql security invoker set search_path = '' as $$
  delete from public.youtube_oauth_states where state_hash = p_hash returning *;
$$;
revoke all on function public.consume_youtube_state(text) from public, anon, authenticated;
grant execute on function public.consume_youtube_state(text) to service_role;
commit;
