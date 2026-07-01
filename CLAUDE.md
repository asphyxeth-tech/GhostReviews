# CLAUDE.md — ghost.reviews

Drop this file in the repo root. Claude Code reads it automatically at the start of every session.

## What we're building

**ghost.reviews** — a B2B service that helps local businesses detect coordinated / fraudulent review attacks ("review bombing") on their **Google Business Profile**, builds an evidence report, and handles **policy-violation removal requests** through Google's official channels.

Originally built for a June 2026 hackathon; now being developed into a real small-business SaaS. The hackathon framing (judging criteria, sponsor challenges, submission deadlines) no longer applies — product and revenue do.

The operator (Devon) is non-technical and relies on you for everything. Explain what each file does in plain language. Before any big/destructive step, briefly say what you're about to do.

## Business model (current direction — confirm pricing with Devon before publishing anywhere)

- **Free instant scan** (the public site) — lead generation. ~40 most-recent reviews, no login.
- **Paid one-shot audit** — full review-history scan + evidence report + drafted removal requests.
- **Monitoring subscription** — monthly re-scans, alerts on new flagged reviews.
- **Done-for-you concierge** (the differentiator) — the customer adds us as a **Manager on their Google Business Profile** (Google's official delegation model); we file the policy-violation reports on their behalf and track outcomes. Nobody at SMB price points does this today — competitors stop at "flag it yourself."
- Pricing model under discussion: hybrid subscription + per-filing or success fee. **Do not publish prices on the site until Devon confirms.**

## Legal grounding (use for product judgment)

- FTC Consumer Review Rule (16 CFR Part 465, effective Oct 2024; penalties ~$53k/violation). **§ 465.7 contains an explicit carve-out**: removing reviews you reasonably believe are fake, off-topic, defamatory, or harassing — with criteria applied evenhandedly regardless of sentiment — is NOT illegal review suppression. Our entire targeting framework lives inside that carve-out. Stay there.
- Google's third-party policies require: **written/digital consent** from the business (verbal isn't sufficient), the customer's ability to **disassociate within 7 business days**, and never implying special Google access or guaranteed removals. Build these into onboarding.
- Removal requests go through Google's Reviews Management Tool / GBP report flow as a delegated Manager. There is no takedown API; filings are manual. That's the concierge labor customers pay for.

## Ethical & legal guardrails (NON-NEGOTIABLE)

- Target ONLY genuinely suspicious / policy-violating reviews. NEVER help bury honest negative criticism — suppressing legitimate reviews is itself an FTC violation and is off the table.
- Outputs are probabilistic signals with transparent reasoning, not accusations.
- We file removal *requests* through Google's official channels with the owner's documented consent. We do NOT delete reviews, automate mass-flagging, or attempt to game Google's systems.
- Only public review content (free scans) or owner-authorized data (connected customers). No scraping of private/personal data.
- Decline prospective customers whose actual goal is suppressing honest critics.

## Detection signals (what the analysis looks for)

- Timing clusters: bursts of negative reviews in a short window
- Reviewer red flags: single-review / low-activity accounts, no history
- Language patterns: near-identical phrasing, generic/templated text
- No evidence of a genuine visit / transaction
- Rating distribution anomalies (sudden 1-star cluster vs. a healthy baseline)
- Vague complaints with no specifics

Always frame output as **likelihood / signals with reasons** — never a definitive "this is fake" verdict.

## Tech stack

**Current:**
- Frontend: Next.js (App Router) + Tailwind on Vercel
- Instant scan: `/api/analyze` (Outscraper blended pull → Claude analysis, ~60 reviews; Nimble fallback REMOVED — see `docs/COST_OVERHAUL.md`)
- Deep audit: Tower serverless Python pipeline (`pipeline/`), ~200 reviews — ADMIN-ONLY now, on the retirement path (COST_OVERHAUL §4.5)
- Analysis: Claude API — system prompt and schema kept in lockstep between `src/lib/anthropic.ts` and `pipeline/task.py`
- Cost posture: see `docs/COST_OVERHAUL.md` (the decided plan; its §5 rejected-ideas list is binding)

**Target (agreed direction, build incrementally):**
- **Supabase** — Postgres + auth (magic link) for customers, businesses, scan history, filing tracker
- **Inngest** (or similar) — background jobs + monthly cron scans, replacing Tower
- **Google Business Profile API** — applied, REJECTED Jun 2026 (listing/website mismatch). Not a dependency: Outscraper covers connected customers; revisit only if the savings ever matter.
- **Scraping vendor** — decided: Outscraper is the only review source (negatives-only deep pulls). Nimble deleted; paid Outscraper discovery deleted (Google Places is mandatory for discovery).
- **Stripe** (billing, shipped test-mode) + **Resend** (email, wired env-gated).

## Conventions

- Keep API keys in `.env.local`; NEVER commit them. Add `.env*` to `.gitignore`.
- Prefer simple, readable code with plain-language comments.
- Commit frequently; push every session.
- When you learn a setup step or command, add it to "Key commands" below.

## Key commands

Local development (Next.js):

- `npm install` — install dependencies (first time, or after a teammate adds a package)
- `npm run dev` — start the dev server at http://localhost:3000 (hot-reload)
- `npm run build` — production build (runs TypeScript + ESLint, generates static pages)
- `npm run start` — run the production build locally (after `npm run build`)
- `npm run lint` — run ESLint

Security:

- `git config core.hooksPath .githooks` — enable the local pre-commit secret scanner (one time per clone)
- See `SECURITY.md` for the full secret-hygiene policy.

Tower pipeline (Python, lives in `pipeline/`):

- `pip install -r pipeline/requirements.txt` — install Python deps (just `anthropic`)
- `pip install -U tower` — install the Tower CLI
- `tower login` — one-time auth
- `cd pipeline && tower run --local --parameter business_url=<URL>` — run the pipeline locally
- `cd pipeline && tower deploy` — push to Tower Cloud
- `cd pipeline && tower run --parameter business_url=<URL>` — run on Tower Cloud
- `tower secrets create ANTHROPIC_API_KEY --value "sk-ant-..."` — set the Claude key for cloud runs
- Optional parameters: `max_reviews` (default 200) and `since` (ISO date, incremental scans)
- Without Tower CLI: `BUSINESS_URL=<URL> python3 pipeline/task.py`
- See `pipeline/README.md` for the full integration guide and parity notes with the web app.

Supabase (accounts + scan history):

- Env vars: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both or neither; app degrades gracefully without them)
- Schema lives in `supabase/migrations/` — apply via the Supabase SQL Editor (setup steps in README)
- Magic-link auth: `/login` → email link → `/auth/callback` → `/dashboard`
- Scans run while signed in are auto-saved (`src/lib/scan-store.ts`, hooked into both `/api/analyze` and the Tower poll route); anonymous scans are never persisted
- Row Level Security: customers can only read/insert their own `scans` rows

Web app -> Tower integration:

- `POST /api/analyze-tower` — triggers a deployed Tower run for the given URL, returns `run_seq` immediately
- `GET /api/analyze-tower/[runSeq]` — polls the run's status; once terminal, returns the extracted `AnalyzeResponse`
- UI: the "Full audit" button under the form drives the trigger + poll flow client-side
- Server-side env vars needed: `TOWER_API_KEY` (sk-...) and `TOWER_APP_NAME` (defaults to `ghost-reviews`)
- `pipeline/task.py` emits a `__GHOST_RESULT__:{...}` sentinel line so the TS side can extract the structured report from Tower's stdout logs deterministically

## Outreach engine — lessons from live testing (read before tuning prospect.py)

We ran two live prospect scans of London ON across 7-8 verticals (~73
businesses, 4,800 Nimble trial credits → only ~400 spent across the
whole experiment, so credits are NOT the constraint at this scale).
What follows is what we proved — assume any future "let's just bump the
threshold" idea has to survive these realities first.

**The fundamental truth.** The cheap heuristic in `pipeline/prospect.py`
CANNOT reliably tell a coordinated attack from organic noise. Only
reading the review *content* (the Claude analysis on the site) can.
That's by design and it's fine — the pre-filter's job is to NARROW (73
→ 6 for pennies), and Claude's job is to VERIFY (cents per business).
Never try to make the pre-filter into the verifier. The two-stage funnel
is the product.

**False-positive modes we hit, and what they actually look like.** A
"burst" — 3+ negative reviews in a 14-day window — is the engine's
strongest signal, and it triggers in at least four ways that are NOT
attacks. Any future scoring change must keep filtering these out:

1. **Event-driven complaint clusters.** A restaurant on Mother's Day, a
   service business after a bad batch, a hair salon after a stylist
   leaves. peppermoon (London, 4.7★, 864 reviews) scored #1 in our v2
   run on a textbook burst — Claude verification: risk 20, zero flagged,
   the negatives were specific complaints about a busy holiday weekend.
   These are real customer experiences, not attacks. Suppressing them
   would BE an FTC violation under § 465.7.

2. **Volume artifacts on high-traffic businesses.** Reliance HVAC has
   ~13,000 lifetime reviews. 3 negatives in any 14 days at that volume
   is statistically guaranteed background noise, not a signal. The fix
   we identified but haven't shipped: make burst velocity-aware —
   normalize "negatives per 14 days" by the business's overall review
   rate before scoring it. (~15 min change.)

3. **Lone low-history reviewers.** In v1 we gave 25 points to "recent
   negatives mostly from accounts with <=2 lifetime reviews" on its
   OWN. That produced false positives at peppermoon and Two Small Men
   Moving (both clean under Claude). Lone throwaway-account reviewers
   are just life; they only matter as CORROBORATION when an attack
   anchor (burst/spike) is already firing. The v2 scoring (burst/spike
   as required anchors, throwaway as +20 corroboration only) reflects
   this and works — keep it.

4. **Chronically low ratings.** Law firms structurally collect angry
   reviews from opposing parties and losing clients. McKenzie Lake
   (3.6★, 91 reviews, 31% 1-stars) scored 25 in v1 — that's a business
   quality / industry-niche signal, NOT an attack. v2 removed
   chronic-low scoring entirely; keep it removed.

**What DOES reliably indicate a real lead, based on what Claude flagged
in our two verified London leads** (Vanity House salon, Ricky Ratchets
auto):

- **Textless 1-star reviews** (zero or near-zero review text) from
  accounts with no other Google reviews — this was the single most
  reliable signal across both real leads.
- **Tight time clusters** of 1-stars, especially under an hour apart
  (Ricky Ratchets had two 1-stars 26 min apart, one with no text).
- **Vague accusations with no falsifiable specifics** from low-history
  accounts (e.g. "Not suited for the area. Very low quality work." with
  no service named, no stylist named, no date).
- These patterns showed up at depth-50 but were INVISIBLE at depth-10.
  Don't scale depth below ~50; if anything, consider depth-100 on
  targeted runs.

**Operational discipline (don't drop these in a future session):**

- Pre-filter precision in testing was ~33% (2 leads of 6 candidates).
  That's fine. Don't try to "improve" it by relaxing anchors — that
  re-introduces v1's noise. Improve it by making Claude verification
  CHEAPER, not the pre-filter SMARTER.
- ALWAYS run Claude verification before any business becomes a lead.
  Never email based on `prospect.py` output alone.
- NEVER commit named-business prospect lists to the repo. The repo is
  effectively public and "we think these businesses are being attacked"
  isn't something to publish. Keep prospect CSVs in /tmp or in Devon's
  private notes; the *engine* belongs in git, the *targets* don't.
- The whole funnel exists to PROTECT Devon's time — he only ever sees
  Claude-verified leads. Don't undermine that by routing raw prospector
  output anywhere user-facing.

**Sub-agent usage for outreach:** verification + email-packet drafting
parallelize naturally — fan out one Sonnet subagent per candidate when
a scan produces >2 hits. Each subagent: curl the live API, judge
honestly (refuse to manufacture a pitch from a clean report — this is
the guardrail), draft from `docs/OUTREACH.md` template. Do NOT spin up
subagents for the Nimble pull itself; that's network-bound, not
Claude-bound, and the in-script thread pool (`--workers`) is the right
layer.



1. **Depth**: wire `max_reviews` from the UI through `/api/analyze-tower` to the pipeline (Towerfile + task.py already support it)
2. **Persistence + auth**: ✅ first cut shipped (Supabase magic-link login, auto-saved scan history, `/dashboard`); next: per-business grouping + rating timeline
3. **DFY workflow**: filing tracker (drafted → submitted → outcome), GBP-manager onboarding flow with written-consent checkbox + one-click disassociation
4. **Scheduling**: monthly auto-scans + diff alerts; Stripe billing
5. **Lead gen**: rating-dip detector for outbound prospecting
