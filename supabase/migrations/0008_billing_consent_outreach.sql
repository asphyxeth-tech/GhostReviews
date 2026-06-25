-- ghost.reviews — 0008: the plumbing for the concierge moat.
--
-- This migration adds everything the pre-launch audit found missing so that a
-- real client can be onboarded HONESTLY and billed SAFELY:
--
--   1. clients: documented written/digital CONSENT + a separate ACCESS state
--      (card-on-file and manager-access-granted are different things, tracked
--      separately) + a token expiry.
--   2. stripe_events: a processed-events ledger so webhook retries can never
--      double-process a charge (Stripe delivers at-least-once).
--   3. removal_charges: one row per success-fee charge, linked to the filing it
--      pays for, with amounts stored in MINOR units (cents) to kill the
--      dollars-vs-cents landmine, plus an idempotency key.
--   4. suppressions: the CASL/CAN-SPAM opt-out (do-not-contact) list the
--      outreach playbook mandates.
--
-- Same access model as the other internal tables: RLS ON, NO public policies,
-- all writes go through the service role behind the ADMIN_EMAILS gate (or, for
-- consent, the token-gated onboarding server route).
--
-- Apply via the Supabase SQL Editor. Safe to re-run (idempotent).

-- ---------------------------------------------------------------------------
-- 1. clients: consent + access state + token expiry
-- ---------------------------------------------------------------------------
-- Documented consent (Google third-party policy + FTC both require WRITTEN /
-- digital consent — verbal isn't enough). We store the exact text shown, a
-- version tag, when it was agreed, and the IP/user-agent as proof.
alter table public.clients add column if not exists consent_text       text;
alter table public.clients add column if not exists consent_version    text;
alter table public.clients add column if not exists consent_at         timestamptz;
alter table public.clients add column if not exists consent_ip         text;
alter table public.clients add column if not exists consent_user_agent text;

-- Manager access is a SEPARATE prerequisite from the card. A client can have a
-- card on file (status='active') while we still have no access to their Google
-- profile — these must not be conflated.
--   none    : we have not been invited / no access
--   invited : the client says they sent the Google "Manager" invite
--   active  : we accepted the invite and can file on their behalf
--   revoked : access was removed (the client's 7-day disassociation right, or
--             they later removed us) — never auto-charge in this state
alter table public.clients add column if not exists access_status    text not null default 'none';
alter table public.clients add column if not exists access_granted_at timestamptz;
alter table public.clients add column if not exists access_revoked_at timestamptz;

-- Onboarding links shouldn't live forever (they reveal business name + fee
-- terms and, pre-auth, let anyone start a Stripe setup session).
alter table public.clients add column if not exists onboarding_token_expires_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. stripe_events: webhook idempotency ledger
-- ---------------------------------------------------------------------------
-- The webhook inserts the event id here FIRST (on conflict do nothing). If the
-- insert affects zero rows we've already processed this event and return 200
-- without re-running side effects. This is what makes Phase B charge handling
-- safe against Stripe's at-least-once retries.
create table if not exists public.stripe_events (
  event_id    text primary key,
  type        text,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. removal_charges: the success-fee charge ledger
-- ---------------------------------------------------------------------------
-- One row per charge attempt for a removed review. We only ever charge on a
-- CONFIRMED removal, so each charge ties back to exactly one filing.
create table if not exists public.removal_charges (
  id                       uuid primary key default gen_random_uuid(),

  client_id                uuid not null references public.clients (id),
  -- one charge per filing — the UNIQUE constraint is the last line of defence
  -- against charging the same removal twice even if the trigger fires twice.
  filing_id                uuid not null references public.filings (id) unique,
  place_id                 text not null,
  review_id                text,

  -- amount in MINOR units (cents). Always integer. round(fee_dollars * 100).
  amount_minor             integer not null,
  currency                 text not null default 'cad',

  --   pending   : created, not yet charged
  --   succeeded : Stripe confirmed the charge
  --   failed    : declined / SCA required / error (see last_error)
  --   refunded  : we refunded (e.g. Google reinstated the review)
  status                   text not null default 'pending',

  stripe_payment_intent_id text,
  stripe_invoice_id        text,
  -- deterministic key (e.g. "removal:<filing_id>") passed to Stripe so a
  -- duplicated trigger can't double-charge at the API layer either.
  idempotency_key          text unique,
  last_error               text,

  created_at               timestamptz not null default now(),
  charged_at               timestamptz,
  refunded_at              timestamptz
);

create index if not exists removal_charges_client_idx on public.removal_charges (client_id);
create index if not exists removal_charges_status_idx on public.removal_charges (status);

-- ---------------------------------------------------------------------------
-- 4. suppressions: cold-outreach opt-out (CASL/CAN-SPAM do-not-contact)
-- ---------------------------------------------------------------------------
-- Honor an unsubscribe within 10 business days and never re-contact. Checked
-- before every outreach send. Email is stored lowercased as the key.
create table if not exists public.suppressions (
  email        text primary key,
  reason       text,                                   -- e.g. 'reply-stop', 'manual', 'bounce'
  source       text,                                   -- where the opt-out came from
  opted_out_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: lock everything to the service role (no public policies).
-- ---------------------------------------------------------------------------
alter table public.stripe_events   enable row level security;
alter table public.removal_charges enable row level security;
alter table public.suppressions    enable row level security;
