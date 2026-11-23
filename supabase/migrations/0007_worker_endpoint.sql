-- The media worker reports its current public address here when it starts (quick tunnels change address).
-- One row only. RLS on with no policies: service role only.
create table public.worker_endpoint (
  id int primary key default 1 check (id = 1),
  url text not null,
  updated_at timestamptz not null default now()
);
alter table public.worker_endpoint enable row level security;
