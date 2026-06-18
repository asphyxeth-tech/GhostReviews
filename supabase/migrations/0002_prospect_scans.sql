-- ghost.reviews — prospect_scans: server-side flywheel for the admin dashboard.
--
-- Internal/admin data (NOT customer-facing). Access is gated at the app layer
-- (ADMIN_EMAILS allowlist); writes go through the service role; there are
-- deliberately NO public RLS policies. Mirrors pipeline/datastore.py (local
-- SQLite) but persisted for the Vercel prospecting dashboard.
--
-- Apply via the Supabase SQL Editor (same as 0001_scans.sql).

create table public.prospect_scans (
  id              uuid primary key default gen_random_uuid(),

  -- identity
  place_id        text,
  business_name   text,
  query           text,
  vertical        text,

  -- context
  total_reviews   integer,
  scan_depth      integer,

  -- what the algorithm said
  prefilter_score integer,
  anchor_fired    boolean,
  rules_fired     jsonb,
  counts          jsonb,
  flagged_reviews jsonb,          -- incl. author_id (cross-business convergence)

  -- outcome labels we backfill as they resolve (the training signal)
  outcome_label   text,           -- real_attack | clean | unknown
  claude_verified boolean,
  outreach_status text,           -- none | emailed | replied | converted

  scanned_at      timestamptz not null default now(),
  scanned_by      uuid references auth.users (id)
);

create index prospect_scans_place_idx   on public.prospect_scans (place_id);
create index prospect_scans_scanned_idx on public.prospect_scans (scanned_at desc);

-- RLS on, NO public policies: the anon key can't touch this table. The admin
-- API routes use the service role (which bypasses RLS) after verifying the
-- caller is an admin at the app layer (ADMIN_EMAILS).
alter table public.prospect_scans enable row level security;
