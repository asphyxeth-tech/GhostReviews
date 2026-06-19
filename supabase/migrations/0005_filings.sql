-- ghost.reviews — filings: the removal-request tracker (Phase 3).
--
-- One row per flagged review we file with Google for a business. Lives in its
-- own table (not inside a prospect_scans snapshot) because a filing is
-- longitudinal — it persists across re-scans as it moves drafted → submitted →
-- removed/denied. Internal/admin-only: same access model as the other admin
-- tables (ADMIN_EMAILS gate + service-role writes; RLS on, no public policies).
--
-- Removal detection note: Google has no removal API or notification, so the
-- honest mechanism for "did it come off?" is a monthly re-scan + diff (a filed
-- review that no longer appears was very likely removed). For now status is set
-- by the operator; auto-detection on re-scan is a later enhancement.
--
-- Apply via the Supabase SQL Editor. Safe to re-run.

create table if not exists public.filings (
  id             uuid primary key default gen_random_uuid(),

  -- what was filed
  place_id       text not null,
  review_id      text not null,

  -- denormalized snapshot of the review (so the tracker shows it even after the
  -- review drops out of a later scan)
  business_name  text,
  author_name    text,
  rating         integer,
  posted_at      text,
  text_snippet   text,
  review_link    text,

  -- the filing itself
  status         text not null default 'drafted',  -- drafted | submitted | removed | denied
  removal_reason text,                               -- policy basis (fake, off-topic, harassment, ...)
  notes          text,
  submitted_at   timestamptz,
  resolved_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  scanned_by     uuid references auth.users (id),

  unique (place_id, review_id)
);

create index if not exists filings_place_idx on public.filings (place_id);

alter table public.filings enable row level security;
