-- Radar monitoring: every AI step a run takes (exact input, raw output, which model answered, what the
-- server's checks kept or dropped), so the creator's Claude or Codex can re-evaluate it over MCP and
-- leave a review. Reviews advise; the creator still decides (radar_ideas.status).
-- The scan that produced an idea, so a reviewer can walk from an idea back to the AI step behind it.
alter table public.radar_ideas add column run_id uuid references public.radar_runs(id) on delete set null;

create table public.radar_ai_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.radar_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idea_id uuid references public.radar_ideas(id) on delete set null,
  step text not null check (step in ('cluster', 'change_note')),
  model text,
  input text not null,
  output text,
  checks jsonb not null default '{}',
  error text,
  ms integer,
  created_at timestamptz not null default now()
);
create index radar_ai_steps_run on public.radar_ai_steps(run_id, created_at);

create table public.radar_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idea_id uuid not null references public.radar_ideas(id) on delete cascade,
  reviewer text not null check (reviewer in ('claude', 'codex', 'other')),
  model text check (char_length(model) <= 80),
  verdict text not null check (verdict in ('keep', 'fix', 'drop')),
  notes text not null check (char_length(notes) between 1 and 2000),
  suggestion jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index radar_reviews_idea on public.radar_reviews(idea_id, created_at desc);

alter table public.radar_ai_steps enable row level security;
alter table public.radar_reviews enable row level security;
revoke all on public.radar_ai_steps, public.radar_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.radar_ai_steps, public.radar_reviews to service_role;
grant select on public.radar_ai_steps, public.radar_reviews to authenticated;
create policy "read own radar steps" on public.radar_ai_steps for select to authenticated using (user_id = (select auth.uid()));
create policy "read own radar reviews" on public.radar_reviews for select to authenticated using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.radar_reviews;
