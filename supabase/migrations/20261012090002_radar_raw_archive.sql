-- Radar: keep each scan's full collected pool, and let the creator archive ideas before deleting them.
-- raw: every video and headline a scan collected (not only the ones shown to the model) and each topic's
-- scoring search, so a reviewer over MCP (get_radar_run) can redo the grouping from scratch.
alter table public.radar_runs add column raw jsonb;

-- archived: put aside, kept out of new scans; only archived ideas can be deleted for good.
alter table public.radar_ideas drop constraint radar_ideas_status_check;
alter table public.radar_ideas add constraint radar_ideas_status_check check (status in ('new', 'saved', 'dropped', 'archived'));
grant delete on public.radar_ideas to authenticated;
create policy "delete own archived ideas" on public.radar_ideas for delete to authenticated
  using (user_id = (select auth.uid()) and status = 'archived');
