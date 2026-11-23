alter table public.clips add column if not exists words jsonb;          -- word timestamps relative to the clip, for caption editing
alter table public.clips add column if not exists needs_manual_crop boolean not null default false;
alter table public.clips add column if not exists caption_style text;
alter table public.clips add column if not exists crf int;
alter table public.workspaces add column if not exists stripe_customer_id text unique;
alter table public.workspaces add column if not exists stripe_subscription_id text unique;

-- Processed worker callbacks, so a retried callback cannot create duplicate clips.
create table public.worker_events (
  id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.worker_events enable row level security; -- no policies: service role only
