-- Phase 2-5 schema: distribution plans, Oyinca destination accounts, transfers, plan limits and quota checks.

create type public.transfer_status as enum ('pending', 'uploading', 'transferred', 'awaiting_approval', 'failed', 'cancelled');

-- Destination accounts discovered through an Oyinca connection (read from Oyinca, never assumed).
create table public.oyinca_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connection_id uuid not null references public.oyinca_connections (id) on delete cascade,
  external_brand_id text not null,    -- Oyinca brand/workspace id
  external_account_id text not null,  -- Oyinca social account id
  platform text not null,
  handle text,
  can_submit boolean not null default true, -- from the permissions Oyinca reports
  created_at timestamptz not null default now(),
  unique (connection_id, external_account_id)
);
create index on public.oyinca_accounts (workspace_id);

create table public.distribution_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  account_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table public.distribution_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  created_by uuid not null references auth.users (id),
  name text not null,
  seed bigint not null default 0,
  interval_minutes int not null default 60 check (interval_minutes > 0),
  min_gap_minutes int not null default 90 check (min_gap_minutes >= 0),
  start_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'saved', 'sent')),
  created_at timestamptz not null default now()
);
create index on public.distribution_plans (workspace_id, created_at desc);

create table public.distribution_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.distribution_plans (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  account_id uuid not null references public.oyinca_accounts (id) on delete cascade,
  position int not null,
  scheduled_at timestamptz,
  unique (plan_id, account_id, clip_id)
);
create index on public.distribution_items (plan_id, account_id, position);

-- One transfer per item, enforced by a unique key, so a retry can never create a duplicate submission.
create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  item_id uuid not null unique references public.distribution_items (id) on delete cascade,
  idempotency_key text not null unique,
  status public.transfer_status not null default 'pending',
  oyinca_asset_id text,
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);
create index on public.transfers (workspace_id, status);

-- Plan limits. Numbers are placeholders until real processing costs are benchmarked; prices are not set here.
create table public.plan_limits (
  plan text primary key,
  max_active_projects int not null,
  max_processing_minutes_month numeric not null,
  max_clips_month int not null,
  max_storage_bytes bigint not null,
  max_oyinca_connections int not null,
  max_concurrent_jobs int not null
);
insert into public.plan_limits values
  ('free',   3,   60,   30,  2147483648, 1, 1),
  ('pro',    25,  600,  400, 53687091200, 5, 2),
  ('agency', 100, 3000, 2000, 268435456000, 25, 5);

create or replace function public.workspace_usage(ws uuid)
returns table (processing_minutes numeric, clips_this_month bigint, storage_bytes numeric, active_projects bigint, connections bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(quantity) from usage_events where workspace_id = ws and kind = 'processing_minutes' and created_at >= date_trunc('month', now())), 0),
    (select count(*) from clips where workspace_id = ws and created_at >= date_trunc('month', now())),
    coalesce((select sum(size_bytes) from clips where workspace_id = ws), 0)
      + coalesce((select sum(source_size_bytes) from projects where workspace_id = ws and source_path is not null), 0),
    (select count(*) from projects where workspace_id = ws and status in ('queued', 'processing')),
    (select count(*) from oyinca_connections where workspace_id = ws and status = 'active');
$$;

-- Server-side enforcement. Returns null when allowed, otherwise the reason. Called by the API before queuing work.
create or replace function public.check_quota(ws uuid, kind text, amount numeric default 1)
returns text language plpgsql stable security definer set search_path = public as $$
declare lim plan_limits; u record;
begin
  select pl.* into lim from plan_limits pl join workspaces w on w.plan = pl.plan where w.id = ws;
  if lim is null then return 'unknown plan'; end if;
  select * into u from workspace_usage(ws);
  if kind = 'processing' then
    if u.processing_minutes + amount > lim.max_processing_minutes_month then return 'monthly processing minutes exceeded'; end if;
    if u.active_projects >= lim.max_concurrent_jobs then return 'too many jobs running'; end if;
  elsif kind = 'clips' then
    if u.clips_this_month + amount > lim.max_clips_month then return 'monthly clip limit exceeded'; end if;
  elsif kind = 'storage' then
    if u.storage_bytes + amount > lim.max_storage_bytes then return 'storage limit exceeded'; end if;
  elsif kind = 'connection' then
    if u.connections + amount > lim.max_oyinca_connections then return 'connection limit exceeded'; end if;
  else
    return 'unknown quota kind';
  end if;
  return null;
end $$;

alter table public.oyinca_accounts enable row level security;
alter table public.distribution_presets enable row level security;
alter table public.distribution_plans enable row level security;
alter table public.distribution_items enable row level security;
alter table public.transfers enable row level security;
alter table public.plan_limits enable row level security;

create policy plan_limits_read on public.plan_limits for select using (true);

create policy oacc_select on public.oyinca_accounts for select using (public.is_member(workspace_id));

create policy presets_select on public.distribution_presets for select using (public.is_member(workspace_id));
create policy presets_write on public.distribution_presets for all
  using (public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]))
  with check (public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]));

create policy plans_select on public.distribution_plans for select using (public.is_member(workspace_id));
create policy plans_write on public.distribution_plans for all
  using (public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]))
  with check (created_by = auth.uid() and public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]));

create policy items_select on public.distribution_items for select using (public.is_member(workspace_id));
create policy items_write on public.distribution_items for all
  using (public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]))
  with check (public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]));

-- Transfers are written by the server (service role) only; members can watch status.
create policy transfers_select on public.transfers for select using (public.is_member(workspace_id));

-- Defence in depth: items must reference clips and accounts of the same workspace.
create or replace function public.check_item_workspace() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from clips where id = new.clip_id and workspace_id = new.workspace_id)
     or not exists (select 1 from oyinca_accounts where id = new.account_id and workspace_id = new.workspace_id) then
    raise exception 'clip or account belongs to another workspace';
  end if;
  return new;
end $$;
create trigger distribution_items_same_workspace before insert or update on public.distribution_items
  for each row execute function public.check_item_workspace();
