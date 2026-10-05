create table public.social_connections (
  provider text not null check (provider in ('tiktok','instagram')),
  user_id uuid not null references auth.users(id) on delete cascade,
  credentials text not null,
  account_id text not null,
  account_title text not null,
  connected_at timestamptz not null default now(),
  primary key (provider,user_id)
);
create table public.social_oauth_states (
  provider text not null check (provider in ('tiktok','instagram')),
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  origin text not null,
  expires_at timestamptz not null
);
create index social_oauth_states_expiry on public.social_oauth_states(expires_at);
alter table public.social_connections enable row level security;
alter table public.social_oauth_states enable row level security;
revoke all on public.social_connections, public.social_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.social_connections, public.social_oauth_states to service_role;
create function public.consume_social_state(p_provider text, p_hash text)
returns setof public.social_oauth_states language sql security invoker set search_path = '' as $$
  delete from public.social_oauth_states where provider=p_provider and state_hash=p_hash returning *;
$$;
revoke all on function public.consume_social_state(text,text) from public, anon, authenticated;
grant execute on function public.consume_social_state(text,text) to service_role;
