begin;
do $$
begin
  if has_table_privilege('anon','public.projects','SELECT') or has_table_privilege('anon','public.projects','INSERT') then
    raise exception 'Anonymous role can read or create projects';
  end if;
  if has_column_privilege('authenticated','public.projects','user_id','UPDATE') then
    raise exception 'Creators can move a project to another account';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.projects'::regclass) then raise exception 'RLS is disabled'; end if;
  if has_table_privilege('anon','public.bridge_devices','SELECT') or has_table_privilege('authenticated','public.bridge_devices','SELECT')
    or has_table_privilege('authenticated','public.bridge_devices','INSERT') then
    raise exception 'Browser roles can see or add Blender devices';
  end if;
end $$;
do $$
declare u uuid; other uuid; mine uuid; theirs uuid; n int; claimed public.video_jobs;
begin
  select id into u from auth.users order by created_at limit 1;
  select id into other from auth.users where id <> u limit 1;
  if u is null then raise exception 'Existing test creator required'; end if;
  -- Another creator's project, made as the service role.
  if other is not null then insert into public.projects(user_id,name) values(other,'theirs') returning id into theirs; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.projects(name) values('boundary-test') returning id into mine;
  begin
    insert into public.projects(name) values('   ');
    raise exception 'Created a project with a blank name';
  exception when check_violation then null; end;
  insert into public.video_jobs(kind,project_id,input) values('script',mine,'{}');
  if theirs is not null then
    select count(*) into n from public.projects where id = theirs;
    if n <> 0 then raise exception 'Read another creator''s project'; end if;
    begin
      insert into public.video_jobs(kind,project_id,input) values('breakdown',theirs,'{}');
      raise exception 'Queued a job in another creator''s project';
    exception when insufficient_privilege then null; end;
  end if;
  insert into public.video_jobs(kind,project_id,input) values('blockout',mine,'{}');
  reset role;

  -- The server loop never claims blockouts; the bridge claims only its own creator's.
  delete from public.video_jobs where status = 'queued' and id not in (select id from public.video_jobs where project_id = mine);
  select * into claimed from public.claim_video_job();
  if claimed.kind = 'blockout' then raise exception 'Server loop claimed a blockout'; end if;
  if other is not null then
    select * into claimed from public.claim_video_job(array['blockout'], other);
    if claimed.id is not null then raise exception 'Bridge claimed another creator''s blockout'; end if;
  end if;
  select * into claimed from public.claim_video_job(array['blockout'], u);
  if claimed.kind is distinct from 'blockout' then raise exception 'Bridge could not claim its blockout'; end if;
end $$;
rollback;
