begin;
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if has_table_privilege(r,'public.social_connections','SELECT')
      or has_table_privilege(r,'public.social_connections','INSERT')
      or has_table_privilege(r,'public.social_connections','UPDATE')
      or has_table_privilege(r,'public.social_connections','DELETE')
      or has_table_privilege(r,'public.social_oauth_states','SELECT')
      or has_function_privilege(r,'public.consume_social_state(text,text)','EXECUTE') then
      raise exception 'Browser role can access social credentials or OAuth state';
    end if;
  end loop;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('social_connections','social_oauth_states') and not c.relrowsecurity) then
    raise exception 'RLS is disabled';
  end if;
end $$;
do $$
declare u uuid; hits integer;
begin
  select id into u from auth.users limit 1;
  if u is null then raise exception 'Existing test creator required'; end if;
  insert into public.social_oauth_states(provider,state_hash,user_id,origin,expires_at)
    values('tiktok','boundary-test-rollback',u,'http://127.0.0.1:5173',now()+interval '10 minutes');
  select count(*) into hits from public.consume_social_state('instagram','boundary-test-rollback');
  if hits<>0 then raise exception 'Cross-provider state consumed'; end if;
  select count(*) into hits from public.consume_social_state('tiktok','boundary-test-rollback');
  if hits<>1 then raise exception 'State consumption failed'; end if;
  select count(*) into hits from public.consume_social_state('tiktok','boundary-test-rollback');
  if hits<>0 then raise exception 'State replay succeeded'; end if;
end $$;
rollback;
