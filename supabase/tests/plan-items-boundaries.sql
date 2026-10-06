begin;
do $$
begin
  if has_table_privilege('anon','public.plan_items','SELECT') or has_table_privilege('anon','public.plan_items','INSERT') then
    raise exception 'Anonymous role can read or add plan items';
  end if;
  if has_column_privilege('authenticated','public.plan_items','user_id','UPDATE') then
    raise exception 'Creators can move a plan item to another account';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.plan_items'::regclass) then raise exception 'RLS is disabled'; end if;
end $$;
do $$
declare u uuid; other uuid; mine uuid; theirs uuid; their_project uuid; n int;
begin
  select id into u from auth.users order by created_at limit 1;
  select id into other from auth.users where id <> u limit 1;
  if u is null then raise exception 'Existing test creator required'; end if;
  -- Another creator's item and project, made as the service role.
  if other is not null then
    insert into public.plan_items(user_id,title) values(other,'theirs') returning id into theirs;
    insert into public.projects(user_id,name) values(other,'theirs') returning id into their_project;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.plan_items(title, scheduled_on) values('boundary-test', current_date) returning id into mine;
  begin
    insert into public.plan_items(title) values('   ');
    raise exception 'Added a plan item with a blank title';
  exception when check_violation then null; end;
  begin
    update public.plan_items set post = '{"url":"javascript:alert(1)"}' where id = mine;
    raise exception 'Saved a non-https post link';
  exception when check_violation then null; end;
  if theirs is not null then
    select count(*) into n from public.plan_items where id = theirs;
    if n <> 0 then raise exception 'Read another creator''s plan item'; end if;
    update public.plan_items set title = 'hijacked' where id = theirs;
    begin
      update public.plan_items set project_id = their_project where id = mine;
      raise exception 'Linked another creator''s project';
    exception when insufficient_privilege then null; end;
  end if;
  reset role;
  if theirs is not null and (select title from public.plan_items where id = theirs) <> 'theirs' then
    raise exception 'Edited another creator''s plan item';
  end if;
end $$;
rollback;
