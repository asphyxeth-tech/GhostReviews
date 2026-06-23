-- ghost.reviews — rate_events: lightweight abuse/cost protection for the public
-- scan endpoints (/api/analyze, /api/analyze-tower).
--
-- One row per anonymous scan; the app counts recent rows per IP and globally to
-- throttle. Internal-only: service-role writes, RLS on, no public policies. The
-- limiter fails OPEN if this table is missing, so scans keep working until it's
-- applied — running this just switches protection on.
--
-- Apply via the Supabase SQL Editor. Safe to re-run.

create table if not exists public.rate_events (
  id          bigint generated always as identity primary key,
  bucket      text not null,            -- which endpoint (e.g. 'analyze')
  ip          text not null,
  created_at  timestamptz not null default now()
);

create index if not exists rate_events_ip_idx
  on public.rate_events (bucket, ip, created_at desc);
create index if not exists rate_events_global_idx
  on public.rate_events (bucket, created_at desc);

alter table public.rate_events enable row level security;
