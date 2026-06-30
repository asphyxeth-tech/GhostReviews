-- ghost.reviews — 0009: the Review Prospector flywheel (free multi-city,
-- time-series review-bomb DISCOVERY), folded into Supabase.
--
-- WHY THIS EXISTS: the existing prospect_scans table is the PAID confirmation
-- layer (a deep Outscraper negatives pull + the v2 scorer, one row per scan).
-- The Prospector is the FREE DISCOVERY layer that decides WHICH businesses are
-- worth that paid pull: it sweeps whole cities via the free Google Places API,
-- snapshots each business's rating over time, and flags ones whose rating is
-- DROPPING (a live bomb) or sits below its peers. These tables hold that cheap,
-- high-volume, longitudinal data — a different cost/volume profile than
-- prospect_scans, so they live separately and join to everything by place_id.
--
-- These mirror the engine's local per-city SQLite schema (businesses, snapshots,
-- flags, tiles, deepdives, reviewers, reviewer_hits, markets) UNIFIED into one
-- cloud Postgres keyspace, with three things the red-team flagged as required:
--   1. snapshots store the RATING (not just the count) — DELTA has nothing to
--      compute from otherwise.
--   2. captured_at is a real timestamp on every snapshot — so DELTA can use the
--      TRUE elapsed time between snapshots (a skipped re-scan must not make the
--      next drop look twice as fast and manufacture a fake "live bomb").
--   3. reviewers are stored by HASH only — no names, no review text — matching
--      the engine's PIIminimized posture (and the fix for the raw-PII the paid
--      path currently keeps in prospect_scans.flagged_reviews).
--
-- Internal/admin-only, same as every other prospect table: RLS ON, NO public
-- policies, all writes via the service role behind the ADMIN_EMAILS gate.
--
-- Apply via the Supabase SQL Editor. Safe to re-run (idempotent).

-- ---------------------------------------------------------------------------
-- 1. businesses — one canonical row per discovered business (place_id is the
--    universal join key, shared with prospect_scans / filings / clients).
-- ---------------------------------------------------------------------------
create table if not exists public.prospector_businesses (
  place_id        text primary key,
  name            text,
  address         text,
  primary_type    text,                 -- Google primary type (e.g. 'hair_salon')
  niches          text,                  -- the seed niche(s) that surfaced it
  areas           text,                  -- neighborhood/area tile(s) it came from
  city            text,                  -- cohort key for the STATIC peer median
  region          text,                  -- ISO-3166 alpha-2 (e.g. 'CA')
  website         text,
  phone           text,
  business_status text,                  -- skip CLOSED_PERMANENTLY downstream
  price_level     text,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);
create index if not exists prospector_businesses_cohort_idx
  on public.prospector_businesses (city, niches);

-- ---------------------------------------------------------------------------
-- 2. snapshots — the cheap rating+count time-series. One row per business per
--    free sweep. This is the substrate DELTA (drop-from-peak) is computed from.
-- ---------------------------------------------------------------------------
create table if not exists public.prospector_snapshots (
  id                bigint generated always as identity primary key,
  place_id          text not null references public.prospector_businesses (place_id) on delete cascade,
  rating            numeric,
  review_count      integer,
  reviews_per_score jsonb,               -- {"1":n,...} when available (else null)
  source            text not null default 'google',  -- 'google' | 'outscraper'
  captured_at       timestamptz not null default now()
);
create index if not exists prospector_snapshots_place_time_idx
  on public.prospector_snapshots (place_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- 3. flags — discovery candidates (DELTA / STATIC). DELTA = rating dropped from
--    its peak (live bomb). STATIC = below niche-peer median (weak; a tiebreaker
--    only — it must never be trusted as a lead on its own).
--    RED-TEAM RULE: these RANK/NARROW which businesses get a paid pull; they
--    NEVER add points to the attack verdict and never lower the Claude gate.
-- ---------------------------------------------------------------------------
create table if not exists public.prospector_flags (
  id              bigint generated always as identity primary key,
  place_id        text not null references public.prospector_businesses (place_id) on delete cascade,
  kind            text not null,         -- 'delta' | 'static'
  rating_delta    numeric,               -- peak_rating - current_rating (delta only)
  count_delta     integer,
  current_rating  numeric,
  current_reviews integer,
  winnability     numeric,               -- closeability rank (NOT a fraud score)
  reason          text,                  -- human-readable ("rating 2.7 vs peer median 4.5")
  status          text not null default 'new',  -- new | queued | scanned | cleared | lead
  flagged_at      timestamptz not null default now()
);
create index if not exists prospector_flags_status_idx
  on public.prospector_flags (status, winnability desc);
create index if not exists prospector_flags_place_idx
  on public.prospector_flags (place_id, flagged_at desc);

-- ---------------------------------------------------------------------------
-- 4. deepdives — aggregate result of a PAID Outscraper deep-dive (counts only,
--    NO review text). One row per deep-dive run on a business.
-- ---------------------------------------------------------------------------
create table if not exists public.prospector_deepdives (
  id                  bigint generated always as identity primary key,
  place_id            text not null references public.prospector_businesses (place_id) on delete cascade,
  run_at              timestamptz not null default now(),
  backend             text,              -- which review source was used
  reviews_pulled      integer,
  negatives           integer,
  throwaway_negatives integer,
  throwaway_ratio     numeric,
  burst_max           integer,
  duplicate_count     integer,
  blacklist_hits      integer,
  lead_score          text               -- STRONG | MEDIUM | WEAK
);
create index if not exists prospector_deepdives_place_idx
  on public.prospector_deepdives (place_id, run_at desc);

-- ---------------------------------------------------------------------------
-- 5. reviewers — the cross-business serial-bomber graph (PII-MINIMIZED:
--    HASHED reviewer ids + counts only; never names or review text). ONE GLOBAL
--    table — the whole value of the graph is cross-city, which per-city SQLite
--    couldn't express but Postgres can.
-- ---------------------------------------------------------------------------
create table if not exists public.prospector_reviewers (
  reviewer_hash   text primary key,      -- SHA-256(author id + server salt)
  lifetime_count  integer,               -- the account's total Google reviews
  is_local_guide  boolean,
  business_count  integer not null default 0,  -- distinct businesses hit (the serial signal)
  is_blacklisted  boolean not null default false,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);

create table if not exists public.prospector_reviewer_hits (
  id             bigint generated always as identity primary key,
  reviewer_hash  text not null references public.prospector_reviewers (reviewer_hash) on delete cascade,
  place_id       text not null,          -- joins to prospector_businesses / prospect_scans
  star           integer,
  posted_at      timestamptz,
  deepdive_id    bigint references public.prospector_deepdives (id) on delete set null,
  flagged_at     timestamptz not null default now(),
  unique (reviewer_hash, place_id)       -- idempotent re-scan writes (mirrors source)
);
create index if not exists prospector_reviewer_hits_reviewer_idx
  on public.prospector_reviewer_hits (reviewer_hash);
create index if not exists prospector_reviewer_hits_place_idx
  on public.prospector_reviewer_hits (place_id);

-- ---------------------------------------------------------------------------
-- 6. markets — the multi-city accumulator registry (replaces data/markets.json)
--    and the per-tile rotation/saturation state (replaces the local `tiles`).
-- ---------------------------------------------------------------------------
create table if not exists public.prospector_markets (
  slug             text primary key,     -- e.g. 'london-ontario-canada'
  city             text,
  region           text,
  verticals        jsonb,                -- the seed niche basket for this market
  areas            jsonb,                -- neighborhoods to tile by
  enabled          boolean not null default true,
  last_advanced_at timestamptz,          -- staleness cursor the daily 'advance' uses
  created_at       timestamptz not null default now()
);

create table if not exists public.prospector_tiles (
  tile_key         text primary key,     -- market + niche + area + refiner
  market_slug      text references public.prospector_markets (slug) on delete cascade,
  niche            text,
  area             text,
  refiner          text not null default '',  -- sub-niche split used to beat the 60-cap
  result_count     integer,              -- if >= page cap, the tile is SATURATED -> split
  last_searched_at timestamptz
);
create index if not exists prospector_tiles_market_idx
  on public.prospector_tiles (market_slug, last_searched_at);

-- ---------------------------------------------------------------------------
-- 7. api_usage — the COST GUARD ledger (Google Places free-event budget +
--    Outscraper). The discovery path increments per request and checks the
--    monthly cap BEFORE spending; over budget -> no-op (return nothing) so daily
--    multi-city accumulation can never silently roll into the paid tier. This is
--    also the in-app spend backstop the rest of the app still owed itself.
-- ---------------------------------------------------------------------------
create table if not exists public.prospector_api_usage (
  provider     text not null,            -- 'google_places' | 'outscraper'
  period       text not null,            -- 'YYYY-MM' (monthly bucket)
  events_used  integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (provider, period)
);

-- ---------------------------------------------------------------------------
-- RLS: lock everything to the service role (no public policies).
-- ---------------------------------------------------------------------------
alter table public.prospector_businesses    enable row level security;
alter table public.prospector_snapshots      enable row level security;
alter table public.prospector_flags          enable row level security;
alter table public.prospector_deepdives      enable row level security;
alter table public.prospector_reviewers      enable row level security;
alter table public.prospector_reviewer_hits  enable row level security;
alter table public.prospector_markets        enable row level security;
alter table public.prospector_tiles          enable row level security;
alter table public.prospector_api_usage      enable row level security;
