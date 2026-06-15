-- ghost.reviews — initial schema: per-user scan history.
--
-- How to apply: paste this whole file into the Supabase SQL Editor
-- (Dashboard -> SQL Editor -> New query -> Run). Safe to run once on a
-- fresh project.
--
-- Design notes:
-- * Supabase Auth owns the users (auth.users) — we never create our own
--   users table.
-- * The full AnalyzeResponse payload is stored as JSONB in `response`;
--   a few hot fields are promoted to real columns so the dashboard can
--   list and sort scans without unpacking JSON.
-- * Row Level Security means each customer can only ever read/write
--   their own scans, enforced by the database itself.

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- What was scanned
  business_url text not null,

  -- Promoted fields from the AnalyzeResponse (for fast dashboard lists)
  mode text not null,                -- "live" | "stub"
  reviews_source text not null,      -- "dataforseo" | "nimble" | "mock"
  reviews_total integer,             -- business's all-time review count (nullable)
  reviews_analyzed integer not null,
  risk_score integer not null,
  risk_level text not null,          -- "low" | "medium" | "high" | "critical"
  flagged_count integer not null,

  -- Set when the scan came from the Tower deep-audit pipeline; used to
  -- avoid saving the same Tower run twice if the client re-polls.
  tower_run_seq bigint,

  -- The complete AnalyzeResponse JSON, so the saved report renders
  -- exactly like the live one.
  response jsonb not null,

  created_at timestamptz not null default now()
);

-- Fast "my scans, newest first" queries.
create index scans_user_created_idx
  on public.scans (user_id, created_at desc);

-- One saved scan per Tower run per user.
create unique index scans_user_tower_run_idx
  on public.scans (user_id, tower_run_seq)
  where tower_run_seq is not null;

-- Customers can only see and create their own rows. No update/delete
-- policies yet — scan history is immutable for now.
alter table public.scans enable row level security;

create policy "scans_select_own"
  on public.scans for select
  using (auth.uid() = user_id);

create policy "scans_insert_own"
  on public.scans for insert
  with check (auth.uid() = user_id);
