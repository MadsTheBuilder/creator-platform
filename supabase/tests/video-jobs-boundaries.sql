begin;
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if has_table_privilege(r,'public.video_jobs','UPDATE') or has_table_privilege(r,'public.video_jobs','DELETE')
      or has_function_privilege(r,'public.claim_video_job()','EXECUTE') then
      raise exception 'Browser role can change or claim video jobs';
    end if;
  end loop;
  if has_table_privilege('anon','public.video_jobs','SELECT') or has_table_privilege('anon','public.video_jobs','INSERT') then
    raise exception 'Anonymous role can read or queue video jobs';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.video_jobs'::regclass) then raise exception 'RLS is disabled'; end if;
end $$;
do $$
declare u uuid; other uuid := gen_random_uuid(); claimed public.video_jobs;
begin
  select id into u from auth.users limit 1;
  if u is null then raise exception 'Existing test creator required'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.video_jobs(kind,input) values('breakdown','{"script":"boundary-test"}');
  begin
    insert into public.video_jobs(user_id,kind,input) values(other,'breakdown','{}');
    raise exception 'Queued a job for another creator';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.video_jobs(kind,status,input) values('render','done','{}');
    raise exception 'Queued a job that was already done';
  exception when insufficient_privilege then null; end;
  reset role;
  select * into claimed from public.claim_video_job();
  if claimed.status <> 'running' then raise exception 'Worker claim failed'; end if;
end $$;
rollback;
