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
- Instant scan: `/api/analyze` (Nimble scrape → Claude analysis, ~40 reviews)
- Deep audit: Tower serverless Python pipeline (`pipeline/`), ~200 reviews, no time ceiling, trigger+poll from the UI
- Analysis: Claude API — system prompt and schema kept in lockstep between `src/lib/anthropic.ts` and `pipeline/task.py`

**Target (agreed direction, build incrementally):**
- **Supabase** — Postgres + auth (magic link) for customers, businesses, scan history, filing tracker
- **Inngest** (or similar) — background jobs + monthly cron scans, replacing Tower
- **Google Business Profile API** — official, free review access for connected customers (requires Google approval; apply early). Scraping then only serves prospect audits / lead gen.
- **Scraping vendor review** — Nimble was a hackathon sponsor choice and has shown latency instability; evaluate Outscraper / DataForSEO / SerpApi on cost and reliability before scaling prospect scans.
- **Stripe** (billing) + **Resend** (email) when first paying customers land.

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

Web app -> Tower integration:

- `POST /api/analyze-tower` — triggers a deployed Tower run for the given URL, returns `run_seq` immediately
- `GET /api/analyze-tower/[runSeq]` — polls the run's status; once terminal, returns the extracted `AnalyzeResponse`
- UI: the "Full audit" button under the form drives the trigger + poll flow client-side
- Server-side env vars needed: `TOWER_API_KEY` (sk-...) and `TOWER_APP_NAME` (defaults to `ghost-reviews`)
- `pipeline/task.py` emits a `__GHOST_RESULT__:{...}` sentinel line so the TS side can extract the structured report from Tower's stdout logs deterministically

## Roadmap (priority order)

1. **Depth**: wire `max_reviews` from the UI through `/api/analyze-tower` to the pipeline (Towerfile + task.py already support it)
2. **Persistence + auth**: Supabase; save scan history per business
3. **DFY workflow**: filing tracker (drafted → submitted → outcome), GBP-manager onboarding flow with written-consent checkbox + one-click disassociation
4. **Scheduling**: monthly auto-scans + diff alerts; Stripe billing
5. **Lead gen**: rating-dip detector for outbound prospecting
