-- Video Studio: Phase 1 schema with tenant isolation via Row Level Security.
-- Every tenant-owned table carries workspace_id; access is decided by workspace membership.

create extension if not exists "pgcrypto";

create type public.workspace_role as enum ('owner', 'admin', 'editor', 'viewer');
create type public.project_status as enum ('queued', 'processing', 'ready', 'failed', 'cancelled');
create type public.source_type as enum ('upload', 'youtube');
create type public.connection_status as enum ('active', 'expired', 'revoked');

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------- workspaces
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id) on delete restrict,
  plan text not null default 'free',
  retention_days int not null default 7 check (retention_days between 1 and 365),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

-- Membership helpers. security definer so policies on workspace_members do not recurse.
create or replace function public.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create or replace function public.has_role(ws uuid, allowed public.workspace_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid() and role = any (allowed)
  );
$$;

-- ---------------------------------------------------------------- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  title text not null,
  source_type public.source_type not null,
  source_url text,
  source_path text,
  source_size_bytes bigint,
  duration_seconds numeric,
  status public.project_status not null default 'queued',
  error text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.projects (workspace_id, created_at desc);

-- ------------------------------------------------------------------- clips
create table public.clips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null check (end_seconds > start_seconds),
  title text,
  description text,
  transcript text,
  hook text,
  category text,
  engagement_score numeric check (engagement_score between 0 and 100), -- an estimate, not a prediction
  selection_reason text,
  status text not null default 'candidate',
  storage_path text,
  size_bytes bigint,
  render_hash text, -- identical settings reuse the same asset
  created_at timestamptz not null default now()
);
create index on public.clips (project_id);
create index on public.clips (workspace_id, created_at desc);
create index on public.clips (workspace_id, render_hash);

-- ------------------------------------------------------------------- usage
-- Written by the server (service role) only; members can read their workspace's usage.
create table public.usage_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  kind text not null, -- processing_minutes | clip_render | storage_bytes | tts_characters | ...
  quantity numeric not null,
  cost_usd numeric,
  created_at timestamptz not null default now()
);
create index on public.usage_events (workspace_id, kind, created_at desc);

-- ------------------------------------------------------- Oyinca connections
-- One workspace can hold several independent connections (separate OAuth grants).
create table public.oyinca_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  label text not null,
  external_account_id text,
  permission_level text,
  status public.connection_status not null default 'active',
  created_at timestamptz not null default now()
);
create index on public.oyinca_connections (workspace_id);

-- Tokens live apart from the readable row. RLS is on with NO policies, so only the service role can touch them.
create table public.oyinca_credentials (
  connection_id uuid primary key references public.oyinca_connections (id) on delete cascade,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz
);

-- ------------------------------------------------ signup: profile + workspace
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));

  insert into public.workspaces (name, owner_id)
  values (coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)) || '''s workspace', new.id)
  returning id into ws;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.add_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.add_owner_membership();

-- --------------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.clips enable row level security;
alter table public.usage_events enable row level security;
alter table public.oyinca_connections enable row level security;
alter table public.oyinca_credentials enable row level security;

-- profiles: own row only
create policy profiles_select on public.profiles for select using (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- workspaces
create policy workspaces_select on public.workspaces for select using (public.is_member(id));
create policy workspaces_update on public.workspaces for update
  using (public.has_role(id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_role(id, array['owner','admin']::public.workspace_role[]));
create policy workspaces_delete on public.workspaces for delete
  using (public.has_role(id, array['owner']::public.workspace_role[]));

-- members: see co-members; owners and admins manage
create policy members_select on public.workspace_members for select using (public.is_member(workspace_id));
create policy members_insert on public.workspace_members for insert
  with check (public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]) and role <> 'owner');
create policy members_update on public.workspace_members for update
  using (public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]) and role <> 'owner')
  with check (public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]) and role <> 'owner');
create policy members_delete on public.workspace_members for delete
  using (public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]) and role <> 'owner');

-- projects
create policy projects_select on public.projects for select using (public.is_member(workspace_id));
create policy projects_insert on public.projects for insert
  with check (created_by = auth.uid() and public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]));
create policy projects_update on public.projects for update
  using (public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]))
  with check (public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]));
create policy projects_delete on public.projects for delete
  using (public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));

-- clips (created by workers via service role; members edit text fields)
create policy clips_select on public.clips for select using (public.is_member(workspace_id));
create policy clips_update on public.clips for update
  using (public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]))
  with check (public.has_role(workspace_id, array['owner','admin','editor']::public.workspace_role[]));
create policy clips_delete on public.clips for delete
  using (public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));

-- usage: read only for members
create policy usage_select on public.usage_events for select using (public.is_member(workspace_id));

-- Oyinca connections: readable by members, managed by owner/admin. No policy on credentials.
create policy oyinca_select on public.oyinca_connections for select using (public.is_member(workspace_id));
create policy oyinca_insert on public.oyinca_connections for insert
  with check (created_by = auth.uid() and public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy oyinca_update on public.oyinca_connections for update
  using (public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy oyinca_delete on public.oyinca_connections for delete
  using (public.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
