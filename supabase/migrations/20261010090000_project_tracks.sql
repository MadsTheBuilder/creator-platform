-- The Playground's two tracks, chosen when a project is created and never changed after:
-- 'production' (footage that is shot or AI-generated: script, breakdown, storyboard, 3D, edit) and
-- 'studio' (motion graphics built in code around the creator's own recording: recording, direction, build, edit).
-- The insert grant covers track; it stays out of the update grant so a project keeps its track.
alter table public.projects add column track text not null default 'production' check (track in ('production','studio'));

-- Studio track: the creator's direction (a few lines plus reference links), and the beat plan their own
-- Claude writes over MCP from the transcript. Only the service role writes the beat plan.
alter table public.projects add column direction text not null default '' check (char_length(direction) <= 4000);
alter table public.projects add column beat_plan text not null default '' check (char_length(beat_plan) <= 20000);
grant update (direction) on public.projects to authenticated;

-- Transcribing an uploaded recording runs in the server loop like scripts and breakdowns.
alter table public.video_jobs drop constraint video_jobs_kind_check;
alter table public.video_jobs add constraint video_jobs_kind_check check (kind in ('breakdown','render','script','blockout','transcribe'));
