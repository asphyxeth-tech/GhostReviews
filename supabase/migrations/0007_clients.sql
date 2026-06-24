-- ghost.reviews — clients: businesses that have signed on and authorized a card
-- on file for success-fee billing (Phase A of the Stripe integration).
--
-- One row per onboarded business. Created by the operator (admin); the business
-- then opens a token-gated /onboard/<token> page and authorizes a card via
-- Stripe-hosted Checkout. A Stripe webhook flips status -> active and saves the
-- payment method. Internal: service-role writes, RLS on, no public policies
-- (the onboarding page reads via the server using the secret token, not the
-- anon client).
--
-- Apply via the Supabase SQL Editor. Safe to re-run.

create table if not exists public.clients (
  id                        uuid primary key default gen_random_uuid(),

  -- which business (links to prospect_scans / filings by place_id).
  -- UNIQUE: one billing client per business — prevents duplicate clients /
  -- Stripe customers from a double-create race, and lets the create route rely
  -- on the DB (not a check-then-insert) for idempotency.
  place_id                  text not null unique,
  business_name             text,
  contact_email             text,

  -- Stripe linkage (test or live, depending on the configured key). UNIQUE so a
  -- webhook can never fan out across multiple rows sharing a customer.
  stripe_customer_id        text unique,
  stripe_payment_method_id  text,

  -- Billing terms. fee_per_removal is in MAJOR units (dollars). Phase B MUST
  -- convert to Stripe minor units (cents) at charge time — amount = round(fee*100)
  -- — and charge in `currency`. Do not assume.
  fee_per_removal           numeric not null default 100,
  currency                  text not null default 'cad',

  status                    text not null default 'pending',  -- pending | active | paused
  onboarding_token          text not null unique,             -- secret link token
  authorized_at             timestamptz,                      -- when the card was saved

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references auth.users (id)
);

create index if not exists clients_place_idx    on public.clients (place_id);
create index if not exists clients_customer_idx on public.clients (stripe_customer_id);

alter table public.clients enable row level security;
