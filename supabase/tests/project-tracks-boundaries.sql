begin;
do $$
begin
  if has_column_privilege('authenticated','public.projects','track','UPDATE') then
    raise exception 'Creators can change a project''s track';
  end if;
  if has_column_privilege('authenticated','public.projects','beat_plan','UPDATE') then
    raise exception 'Creators can write the beat plan directly';
  end if;
  if not has_column_privilege('authenticated','public.projects','direction','UPDATE') then
    raise exception 'Creators cannot save their direction';
  end if;
end $$;
do $$
declare u uuid; p uuid;
begin
  select id into u from auth.users order by created_at limit 1;
  if u is null then raise exception 'Existing test creator required'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.projects(name, track) values('track-test', 'studio') returning id into p;
  if (select track from public.projects where id = p) <> 'studio' then raise exception 'Track was not saved'; end if;
  begin
    insert into public.projects(name, track) values('track-test', 'film');
    raise exception 'Created a project with an unknown track';
  exception when check_violation then null; end;
  begin
    update public.projects set track = 'production' where id = p;
    raise exception 'Changed a project''s track';
  exception when insufficient_privilege then null; end;
  update public.projects set direction = 'Warm, fast, one orange accent.' where id = p;
  begin
    update public.projects set direction = repeat('x', 4001) where id = p;
    raise exception 'Saved an over-long direction';
  exception when check_violation then null; end;
  begin
    insert into public.video_jobs(kind, input, project_id) values('transcribe', '{"file":"take1.mp4"}', p);
  exception when others then raise exception 'Could not queue a transcription: %', sqlerrm; end;
  reset role;
end $$;
rollback;
