-- Only projects actually being processed count against the concurrent-job limit.
-- Queued projects (waiting for the worker to be configured or started) must not block new ones.
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
    (select count(*) from projects where workspace_id = ws and status = 'processing'),
    (select count(*) from oyinca_connections where workspace_id = ws and status = 'active');
end $$;
