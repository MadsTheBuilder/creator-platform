begin;
do $$
begin
  if has_table_privilege('anon','public.creator_styles','SELECT') or has_table_privilege('anon','public.creator_style_files','SELECT') then
    raise exception 'Anonymous role can read styles';
  end if;
  if has_column_privilege('authenticated','public.creator_styles','user_id','UPDATE')
    or has_column_privilege('authenticated','public.creator_style_files','user_id','UPDATE')
    or has_column_privilege('authenticated','public.creator_style_files','path','UPDATE') then
    raise exception 'Creators can move a style or file to another account or path';
  end if;
end $$;
do $$
declare u uuid; other uuid; mine uuid; second uuid; theirs uuid; p uuid; n int;
begin
  select id into u from auth.users order by created_at limit 1;
  select id into other from auth.users where id <> u limit 1;
  if u is null then raise exception 'Existing test creator required'; end if;
  if other is not null then
    insert into public.creator_styles(user_id, name) values(other, 'theirs') returning id into theirs;
    insert into public.creator_style_files(style_id, user_id, path, text) values(theirs, other, 'DESIGN.md', 'secret');
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.creator_styles(name, is_default) values('style-test', true) returning id into mine;
  insert into public.creator_style_files(style_id, path, text) values(mine, 'DESIGN.md', '# Look'), (mine, 'cards/tier1/t1-stat.html', '<div></div>');
  begin
    insert into public.creator_style_files(style_id, path, text) values(mine, '../index.html', 'x');
    raise exception 'Saved a style file outside the allowed paths';
  exception when check_violation then null; end;
  begin
    insert into public.creator_styles(name, is_default) values('second default', true);
    raise exception 'Two default styles';
  exception when unique_violation then null; end;
  insert into public.creator_styles(name) values('second') returning id into second;
  update public.creator_style_files set text = '# Look, edited' where style_id = mine and path = 'DESIGN.md';

  insert into public.projects(name, track, style_id) values('style-project', 'studio', mine) returning id into p;
  update public.projects set beat_plan = 'Beat 1' where id = p;
  if theirs is not null then
    select count(*) into n from public.creator_style_files where style_id = theirs;
    if n <> 0 then raise exception 'Read another creator''s style'; end if;
    begin
      update public.projects set style_id = theirs where id = p;
      raise exception 'Pointed a project at another creator''s style';
    exception when foreign_key_violation then null; end;
    begin
      insert into public.creator_style_files(style_id, path, text) values(theirs, 'notes.md', 'x');
      raise exception 'Added a file to another creator''s style';
    exception when foreign_key_violation or insufficient_privilege then null; end;
  end if;
  delete from public.creator_styles where id = mine;
  if (select style_id from public.projects where id = p) is not null then raise exception 'Deleting a style left the project pointing at it'; end if;
  if (select user_id from public.projects where id = p) <> u then raise exception 'Deleting a style cleared the project owner'; end if;
  reset role;
end $$;
rollback;
