# Ghost Reviews — Handoff / State of Play

_Last updated: 2026-06-26. Living document — update it at the end of any working
session. No secrets and no named prospect/customer lists belong in this file
(the repo is effectively public). Targets live in Devon's private notes._

## What this is

**ghost.reviews** — a B2B service that detects coordinated fake-review attacks
("review bombing") on a local business's **Google Business Profile (GBP)**, and
files **policy-violation removal requests** through Google's official channels as
a delegated **Manager**, on a **success-fee** basis. Operator: Devon
(non-technical). Full product/legal context lives in `CLAUDE.md` — read that
first.

The differentiator ("the moat"): we become a **Manager** on the customer's GBP
and file the reports for them, billed only when a review is actually removed.
Competitors stop at "flag it yourself."

## Where we are right now (launch status)

**Code: done and merged.** A full pre-launch hardening sprint shipped as PR #43
(merged to `main`). The product is built end-to-end: discovery → triage →
verification → onboarding (consent + card) → manager walkthrough → filing →
success-fee charge.

**What's left is config + a smoke test, not code.** See the checklist below.

### Launch checklist

| Step | Status | Notes |
|------|--------|-------|
| Supabase migration `0008` applied | ✅ done | consent/access/billing/suppression tables |
| Google manager identity proven | ✅ done | `devon@ghostreviews.app` (Workspace) accepted a Manager invite on Devon's own Realtor GBP; can reply to reviews + use the Reviews Management Tool |
| `GBP_MANAGER_EMAIL` in Vercel | ✅ done | `devon@ghostreviews.app` |
| `STRIPE_SECRET_KEY` in Vercel | ✅ done | **TEST** key (`sk_test_…`) for now |
| `STRIPE_WEBHOOK_SECRET` in Vercel | ✅ done | from the Test-mode webhook endpoint |
| Stripe webhook endpoint created | ✅ done | `https://ghostreviews.app/api/stripe/webhook`, **Test** mode, scope = **Your account**, payload = Snapshot, API version `2026-05-27.dahlia`; events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` |
| **Smoke test the onboarding flow** | ⏳ NEXT | admin → create onboarding link → open it → consent → card `4242 4242 4242 4242` → webhook 200 → client flips to `active` |
| Spend caps (Anthropic + Outscraper) | ⬜ todo | hard monthly cap in BOTH dashboards — the real cost backstop |
| Swap Stripe TEST → LIVE | ⬜ todo (before charging a real client) | new live key + a **separate live** webhook endpoint + secret; swap the 2 Vercel env vars; redeploy |
| First real client through the live flow | ⬜ todo | the first target's contact details live in Devon's private notes, NOT here |

### Stripe mode note

We are intentionally in **TEST** mode to validate the plumbing safely. The
onboarding step only **saves a card at $0** (Stripe Checkout in `setup` mode) —
it never charges. The only real-money action is the **manual** "Charge success
fee" button after a confirmed removal (Phase B). Before billing a real client,
swap to LIVE keys + a LIVE webhook endpoint (its signing secret is different).

## The two-stage funnel (how leads are found)

The cheap heuristic pre-filter NARROWS; Claude reading review **content**
VERIFIES. Never let the pre-filter become the verifier. Cheapest path:

1. **FREE Google Places (New) discovery** — `src/lib/google-places.ts`, Text
   Search returns rating/review-count/category for triage (60-result cap). Used
   when `GOOGLE_MAPS_API_KEY` is set; Outscraper is the fallback.
2. **Free heuristic triage** — `src/lib/prospect-scoring.ts` ↔
   `pipeline/prospect.py` (kept in lockstep). v2 scoring: BURST/SPIKE are
   required anchors; THROWAWAY/TEXTLESS/TIGHT_CLUSTER corroborate only.
   Velocity-normalized (estimates lifetime negative span). Candidate threshold 50.
3. **Pennies-cheap Outscraper negatives-only pull** — `src/lib/outscraper.ts`
   with `sort=lowest_rating` + `cutoffRating=2` (~85–90% cheaper). Never set
   `ignoreEmpty` (we need textless 1★s — the strongest real-attack signal).
4. **FREE Claude verification** — `src/lib/verification-prompt.ts` packet;
   Devon only ever sees Claude-verified leads. On a GO verdict the packet now
   also drafts the cold email (with the literal CASL footer). On a clean report
   it refuses to manufacture a pitch — that refusal is the guardrail.

The strongest real-attack signal (from live testing): **textless 1★ reviews from
no-history accounts in a tight time cluster.** Restaurants are a pre-filter trap
(event-driven complaint clusters look like bursts but are organic — never email
without Claude verification).

## The customer journey (what happens, in order)

1. **Cold email** (CASL-compliant; templates in `docs/OUTREACH.md`) — sent from a
   **separate** outreach subdomain, not the transactional `devon@` that powers
   auth mail. Check every recipient against the suppression list first:
   `node scripts/scans.mjs check <email>`; record opt-outs with
   `node scripts/scans.mjs suppress <email>`.
2. **Free instant scan** on the public site (`/api/analyze`) — lead-gen. Now
   negatives-aware and never serves a fabricated "attack" (honest errors on
   empty scrape / missing key).
3. **Admin creates a client** (`/admin` → business → Billing panel → "Create
   onboarding link") → a token-gated `/onboard/<token>` link (expires in 14 days).
4. **Customer onboarding** (`/onboard/<token>`): agreement → **required consent
   checkbox** (stored as proof: text/version/at/ip/ua) → **Authorize card** via
   Stripe Checkout (setup mode, $0).
5. **Step 2 — manager access** (`/onboard/<token>/access`): the GBP click-path +
   one-click copy of `GBP_MANAGER_EMAIL`; "I've sent the invite" sets
   `access_status='invited'`. Devon accepts the invite in Google, then clicks
   "Confirm we accepted the manager invite" in the admin Billing panel →
   `access_status='active'`.
6. **Filing** — Devon files via Google's **Reviews Management Tool** (report +
   status tracking; it's a launch-from-help-center tool, not a standing
   dashboard). Tracked in the filings table / `FilingTracker`.
7. **Charge** — only after a **confirmed removal** (status `removed`), and only
   when card-on-file AND `access_status='active'` AND consent captured. Manual
   "Charge success fee" button. Reinstatement → automatic refund.

## Pricing / finance model (recommended; confirm before publishing)

- **Pay-as-you-go:** **$99 CAD per confirmed removal**, no subscription.
- **Monitoring tier:** **$39/mo CAD** (monthly re-scan + fast alerts);
  subscribers pay a discounted **$79 per confirmed removal**.
- Do NOT bundle removals into the subscription (FTC §465.7 incentive hygiene —
  the subscription buys *speed of detection*, not removals).
- Stripe mapping: monitoring = a real Stripe **Subscription** (reuses the saved
  card); per-removal = a one-off itemized **Invoice**.
- **Invoice line item:** `Confirmed Google review removal — success fee`,
  quantity = number removed; statement descriptor `GHOSTREVIEWS REMOVAL`.
- **Prices are not published on the public site yet — confirm with Devon first.**

## Architecture / stack

- **Frontend/app:** Next.js 16 (App Router) + Tailwind + TypeScript on Vercel.
- **DB/auth:** Supabase (Postgres + magic-link auth + RLS). Internal tables have
  RLS ON with **no** public policies; all internal writes go through the
  service role behind the `ADMIN_EMAILS` admin gate (`src/lib/admin.ts`).
- **Billing:** Stripe-hosted Checkout (setup mode) for card-on-file; Phase B
  charge engine in `src/lib/billing.ts` (dollars→cents, idempotency keys,
  decline/SCA handling, refunds). Webhook verifies signatures + is idempotent
  via the `stripe_events` ledger. API version pinned in `src/lib/stripe.ts`.
- **Reviews data:** Outscraper (primary), Nimble (fallback), Anthropic Claude
  for analysis. TS (`src/lib/anthropic.ts`) and Python (`pipeline/task.py`)
  prompt/schema kept in lockstep. Model: `claude-opus-4-8`.
- **Legacy:** Tower serverless pipeline (`pipeline/`) for the deep audit; being
  migrated toward Inngest.

### Key tables (migrations in `supabase/migrations/`)
- `clients` (0007 + 0008): one per onboarded business. `status` (pending|active|
  paused) = card state; **separate** `access_status` (none|invited|active|
  revoked) = Google manager access; consent_* columns; `onboarding_token`
  (+ 14-day expiry); `fee_per_removal` (in **dollars**), `currency`.
- `filings` (0005): removal-request tracker (drafted|submitted|removed|denied|
  reinstated).
- `removal_charges` (0008): success-fee ledger, amounts in **cents**, one row
  per filing (UNIQUE), idempotency key.
- `stripe_events` (0008): webhook idempotency ledger.
- `suppressions` (0008): CASL opt-out / do-not-contact list.
- `prospect_scans`, `scans`, `services`, `rate_events`: flywheel + history +
  cost ledger + rate limiting.

## Environment variables (set in Vercel; see `.env.example`)

Server-only unless prefixed `NEXT_PUBLIC_`. Required for the full flow:
`ANTHROPIC_API_KEY`, `OUTSCRAPER_API_KEY` (+ optional `NIMBLE_API_KEY`),
`GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GBP_MANAGER_EMAIL`.
**Never commit real values.** Env-var changes require a Vercel redeploy to take
effect.

## Legal guardrails (non-negotiable — see CLAUDE.md)

- FTC §465.7 carve-out: only request removal of fake/off-topic/defamatory/
  harassing reviews, applied evenhandedly regardless of sentiment. **Never** help
  bury honest criticism.
- Google third-party policy: written/digital consent (captured at onboarding),
  7-business-day disassociation right, never imply special Google access or
  guaranteed removal.
- CASL/CAN-SPAM: sender ID + physical mailing address + working unsubscribe
  (honored ≤10 business days) on every cold email. Use the CASL footer for all
  recipients. Mailing address (iPostal1, London ON) is on the site + templates.
- Outputs are probabilistic **signals with reasons**, never definitive "this is
  fake" verdicts.

## Known follow-ups (non-blocking)

- `FilingTracker` accepts an optional `initialCharges` prop; the admin page can
  fetch `removal_charges` and pass them so charge state shows on load.
- Wire **Resend** so the pre-charge customer notice (and magic-link/auth mail)
  send automatically instead of being hand-copied.
- Per-business grouping + rating timeline in the dashboard; monthly auto-scan
  cron + diff alerts (the re-scan diff also corroborates "removal confirmed").
- Velocity scoring could add rating-entropy-in-burst as cheap extra-precision
  corroboration (lockstep TS+Python).

## Useful commands

- `npm run dev` / `npm run build` / `npm run lint`
- `node scripts/scans.mjs leads|all|filings|stats` — review the flywheel
- `node scripts/scans.mjs check <email>` / `suppress <email> [reason]` — outreach opt-outs
- Apply migrations via the Supabase SQL Editor (0001–0008, in order).
