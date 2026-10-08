create function public.save_project_script(p_user uuid,p_project uuid,p_expected_hash text,p_script text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects;current_hash text;next_hash text;
begin
  if current_user<>'service_role' and p_user is distinct from (select auth.uid()) then raise exception 'not_found';end if;
  if p_expected_hash !~ '^[a-f0-9]{64}$' or char_length(p_script)>60000 then raise exception 'validation_blocked';end if;
  select * into p from public.projects where id=p_project and user_id=p_user for update;
  if not found then raise exception 'not_found';end if;
  current_hash:=encode(sha256(convert_to(p.script,'UTF8')),'hex');
  if current_hash<>p_expected_hash then raise exception 'version_conflict';end if;
  next_hash:=encode(sha256(convert_to(p_script,'UTF8')),'hex');
  update public.projects set script=p_script,updated_at=now() where id=p.id and user_id=p_user returning * into p;
  return jsonb_build_object('project',to_jsonb(p),'script_hash',next_hash);
end $$;
revoke all on function public.save_project_script(uuid,uuid,text,text) from public,anon;
grant execute on function public.save_project_script(uuid,uuid,text,text) to authenticated,service_role;
-- Direct authenticated UPDATE(script) remains during the compatible-client rollout.
-- Revoke it only after the browser and MCP writers using this RPC are deployed.
