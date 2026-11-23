-- Quota/usage readable only for workspaces the caller belongs to (service role has no auth.uid() and is allowed).
create or replace function public.workspace_usage(ws uuid)
returns table (processing_minutes numeric, clips_this_month bigint, storage_bytes numeric, active_projects bigint, connections bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_member(ws) then
    raise exception 'not a member of this workspace';
  end if;
  return query select
    coalesce((select sum(quantity) from usage_events where workspace_id = ws and kind = 'processing_minutes' and created_at >= date_trunc('month', now())), 0),
    (select count(*) from clips where workspace_id = ws and created_at >= date_trunc('month', now())),
    coalesce((select sum(size_bytes) from clips where workspace_id = ws), 0)
      + coalesce((select sum(source_size_bytes) from projects where workspace_id = ws and source_path is not null), 0),
    (select count(*) from projects where workspace_id = ws and status in ('queued', 'processing')),
    (select count(*) from oyinca_connections where workspace_id = ws and status = 'active');
end $$;

create or replace function public.check_item_workspace() returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from clips where id = new.clip_id and workspace_id = new.workspace_id)
     or not exists (select 1 from oyinca_accounts where id = new.account_id and workspace_id = new.workspace_id) then
    raise exception 'clip or account belongs to another workspace';
  end if;
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.add_owner_membership() from public, anon, authenticated;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.has_role(uuid, public.workspace_role[]) from public, anon;
revoke execute on function public.check_quota(uuid, text, numeric) from public, anon;
revoke execute on function public.workspace_usage(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated, service_role;
grant execute on function public.has_role(uuid, public.workspace_role[]) to authenticated, service_role;
grant execute on function public.check_quota(uuid, text, numeric) to authenticated, service_role;
grant execute on function public.workspace_usage(uuid) to authenticated, service_role;
