-- Live Playground: changes made elsewhere (another tab, the creator's Claude / Codex over the MCP server)
-- reach the open page through Realtime. RLS still limits each creator to their own rows.
alter publication supabase_realtime add table public.projects, public.video_jobs;
