-- ghost.reviews — services: the owner cost/subscription registry.
--
-- A manually-maintained ledger of every external service we pay for (or could),
-- so Devon (or an accountant) can see the whole infrastructure bill in one place
-- and catch subscriptions that are still active but no longer wired into the
-- build. Internal/admin-only — same access model as prospect_scans (app-layer
-- ADMIN_EMAILS gate + service-role writes; RLS on, no public policies).
--
-- There's no unified billing API across vendors, so costs are entered by hand.
-- The dashboard's value is the single pane of glass + the "is this still used?"
-- audit-prompt button, not automated cost pulls.
--
-- Apply via the Supabase SQL Editor. Safe to re-run (seed uses ON CONFLICT).

create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  category      text,                    -- hosting | database | ai | scraping | jobs | email | billing | api | domain | other
  website       text,                    -- service homepage
  manage_url    text,                    -- direct "manage subscription / billing" link
  billing_model text default 'flat',     -- flat (known $/mo) | usage (variable) | annual | free
  monthly_cost  numeric,                 -- known flat monthly cost; null for usage/free
  currency      text default 'USD',
  status        text default 'active',   -- active (subscribed) | inactive (cancelled, kept for record)
  wired         boolean default true,    -- currently referenced in the codebase?
  notes         text,
  updated_at    timestamptz not null default now()
);

alter table public.services enable row level security;

-- Seed with our current stack. Best-effort costs — anything marked "verify" is a
-- guess until Devon checks the actual account. wired=false + status=active is the
-- cancellation-candidate flag the dashboard highlights.
insert into public.services
  (name, category, website, manage_url, billing_model, monthly_cost, currency, status, wired, notes)
values
  ('Vercel', 'hosting', 'https://vercel.com', 'https://vercel.com/account/plans', 'flat', 0, 'USD', 'active', true,
   'Hosting + deploys. Hobby free tier; $20/mo if upgraded to Pro. Verify current plan. Watch serverless function time (deep audit runs to 300s).'),
  ('Supabase', 'database', 'https://supabase.com', 'https://supabase.com/dashboard/project/_/settings/billing', 'flat', 0, 'USD', 'active', true,
   'Postgres + magic-link auth + the flywheel tables. Free tier; $25/mo Pro. Verify plan.'),
  ('Anthropic (Claude API)', 'ai', 'https://www.anthropic.com', 'https://console.anthropic.com/settings/billing', 'usage', null, 'USD', 'active', true,
   'Per-token. The core variable cost — every instant scan and deep audit calls Claude. Set a monthly spend cap in the console.'),
  ('Outscraper', 'scraping', 'https://outscraper.com', 'https://app.outscraper.com/profile', 'usage', null, 'USD', 'active', true,
   'Review + business-search scraping. 500 free reviews/mo, then ~$3/1k. Main prospecting credit burn (depth x #businesses per run).'),
  ('Nimble', 'scraping', 'https://nimbleway.com', 'https://nimbleway.com', 'usage', null, 'USD', 'active', true,
   'Legacy fallback scraper (hackathon trial). Still wired as the Outscraper fallback. Confirm whether the trial/subscription is still active.'),
  ('Tower', 'jobs', 'https://tower.dev', 'https://tower.dev', 'free', 0, 'USD', 'active', true,
   'Serverless Python pipeline for the deep audit. Verify tier/cost. Slated for replacement by Inngest.'),
  ('Inngest', 'jobs', 'https://www.inngest.com', 'https://app.inngest.com/billing', 'free', 0, 'USD', 'active', false,
   'Signed up (event + signing keys grabbed) but NOT yet wired into the app. Free tier. Cancellation candidate until wired.'),
  ('Google Business Profile API', 'api', 'https://developers.google.com/my-business', 'https://console.cloud.google.com', 'free', 0, 'USD', 'active', false,
   'Awaiting approval; not yet wired. Free review access once granted — will replace scraping for connected customers.'),
  ('Resend', 'email', 'https://resend.com', 'https://resend.com/settings/billing', 'free', 0, 'USD', 'inactive', false,
   'Planned transactional email (outreach, alerts). Not yet wired. Free tier 3k emails/mo.'),
  ('Stripe', 'billing', 'https://stripe.com', 'https://dashboard.stripe.com', 'usage', null, 'USD', 'inactive', false,
   'Planned billing. Not yet wired. Per-transaction fees, no monthly subscription.'),
  ('Domain (ghostreviews.app)', 'domain', 'https://ghostreviews.app', null, 'annual', null, 'USD', 'active', true,
   'Domain registration. ~$10-20/yr. Verify registrar + auto-renew date.')
on conflict (name) do nothing;
