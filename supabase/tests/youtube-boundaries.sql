-- Run with: supabase db query --linked --file supabase/tests/youtube-boundaries.sql
-- Uses one existing Auth user only for a temporary FK; transaction always rolls back.
begin;
do $$
declare u uuid; n integer;
begin
  if has_table_privilege('anon','public.youtube_connections','SELECT')
     or has_table_privilege('authenticated','public.youtube_connections','SELECT')
     or has_table_privilege('anon','public.youtube_oauth_states','SELECT')
     or has_table_privilege('authenticated','public.youtube_oauth_states','SELECT') then
    raise exception 'Credentials/state are accessible to a browser role';
  end if;
  if has_function_privilege('anon','public.consume_youtube_state(text)','EXECUTE')
     or has_function_privilege('authenticated','public.consume_youtube_state(text)','EXECUTE') then
    raise exception 'Browser roles can consume OAuth state';
  end if;
  if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname in ('youtube_connections','youtube_oauth_states') and not relrowsecurity) then
    raise exception 'RLS is disabled';
  end if;
  select id into u from auth.users limit 1;
  if u is null then raise exception 'A signed-in test user is required'; end if;
  insert into public.youtube_oauth_states values ('connector-smoke-test',u,'test-verifier','http://127.0.0.1:5173',now()+interval '10 minutes');
  select count(*) into n from public.consume_youtube_state('connector-smoke-test');
  if n <> 1 then raise exception 'First consumption failed'; end if;
  select count(*) into n from public.consume_youtube_state('connector-smoke-test');
  if n <> 0 then raise exception 'Replay was allowed'; end if;
end $$;
rollback;
select 'PASS: browser permissions, RLS and atomic state replay checks' as verification;
