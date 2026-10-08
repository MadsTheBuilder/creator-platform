-- A planned video can come from a Radar idea, and carry the outline the creator's own Claude or Codex wrote for it
-- over MCP (save_outline). The outline is written by the worker only; the creator reads it in the Planner.
alter table public.plan_items
  add column radar_idea_id uuid unique references public.radar_ideas(id) on delete set null,
  add column outline text check (char_length(outline) <= 40000),
  add column outline_at timestamptz;

-- The idea must be the creator's own. radar_idea_id is set on insert only (it is not in the update grant).
alter policy "add to own plan" on public.plan_items
  with check (user_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
    and (radar_idea_id is null or exists (select 1 from public.radar_ideas r where r.id = radar_idea_id and r.user_id = (select auth.uid()))));
