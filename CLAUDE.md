# CLAUDE.md — ghost.reviews

Drop this file in the repo root. Claude Code reads it automatically at the start of every session.

## What we're building

**ghost.reviews** — a B2B web app that helps local businesses detect coordinated / fraudulent review attacks ("review bombing") on their **Google Business Profile**, builds an evidence report, and drafts an official **policy-violation removal request** the owner can submit to Google.

Built for the **DeveloperWeek New York 2026 Hackathon** (online). **Deadline: June 10, 2026, 10:00 AM ET. No late submissions.**

The operator (Devon) is non-technical and relies on you for everything. Explain what each file does in plain language. Before any big/destructive step, briefly say what you're about to do.

## Why it matters (use for product judgment)

- Fake/planted reviews are now federally illegal (FTC Consumer Review Rule; penalties \~$53k/violation). Businesses have real legal \+ financial stakes.  
- A planted 1-star "bomb" can tank a local business's revenue. Detecting \+ getting them removed is a real, paid service.  
- This is a real potential business, not just a hackathon toy. **Build modular** so other platforms (Amazon, Yelp) can be added later without a rewrite.

## Judging criteria we optimize for

1. Creative interpretation of the domain (ghost.reviews \= catching "ghost"/fake reviews)  
2. Technical execution  
3. Product polish & UX  
4. Strength of concept & originality  
5. **How well the project connects back to the domain** ← tightest priority

Overall round also rewards: solves a real problem \+ could become a startup.

## Sponsor challenges to stack (use all three)

- **Nimble** (nimbleway.com): scrape live Google reviews via their Search/Extract/Crawl/Web APIs. Required for the Nimble challenge.  
- **Tower** (tower.dev): Pythonic serverless compute \+ data pipeline. Run the scrape→analyze job here. Free credits regardless of winning.  
- **name.com**: the domain is the conceptual heart. We are NOT registering it (premium domain) — use thematically; deploy the demo to Vercel.

## Core user flow (the MVP)

1. Business owner pastes their Google Business Profile URL (or business name \+ location).  
2. App scrapes recent reviews via Nimble.  
3. Claude API analyzes the reviews for coordinated-attack / authenticity signals.  
4. Output: an **authenticity report** — overall risk score \+ a list of flagged reviews, each with a transparent reason.  
5. For flagged reviews, generate a **drafted Google policy-violation removal request** (text the owner can copy and submit).

## Detection signals (what the analysis looks for)

- Timing clusters: bursts of negative reviews in a short window  
- Reviewer red flags: single-review / low-activity accounts, no history  
- Language patterns: near-identical phrasing, generic/templated text  
- No evidence of a genuine visit / transaction  
- Rating distribution anomalies (sudden 1-star cluster vs. a healthy baseline)  
- Vague complaints with no specifics

Always frame output as **likelihood / signals with reasons** — never a definitive "this is fake" verdict.

## Ethical & legal guardrails (NON-NEGOTIABLE)

- Target ONLY genuinely suspicious / policy-violating reviews. NEVER help bury honest negative criticism — suppressing legitimate reviews is itself an FTC violation and is off the table.  
- Outputs are probabilistic signals with transparent reasoning, not accusations.  
- We generate removal *requests* for the owner to submit through Google's official channels. We do NOT delete reviews, automate mass-flagging, or attempt to game Google's systems.  
- Only public review content. No scraping of private/personal data. No facial data.

## Tech stack

- **Frontend:** Next.js (App Router) \+ Tailwind. Clean, professional B2B aesthetic.  
- **Backend:** Next.js API routes (and/or a small Python service for the pipeline).  
- **Scraping:** Nimble API.  
- **Analysis:** Claude API (Anthropic).  
- **Pipeline:** Tower (serverless Python) for the scrape→analyze job.  
- **Hosting:** Vercel (free).  
- **Repo:** GitHub. Work on `main`, commit often with clear messages, push every session.

## Scope discipline

**IN (MVP):**

- Single platform: Google Business reviews  
- One clean flow: URL in → authenticity report \+ removal-request drafts out  
- Polished UI \+ a working live demo URL

**OUT (roadmap — pitch it, do NOT build now):**

- Amazon, Yelp, other platforms  
- User accounts / auth / billing  
- Real-time monitoring / alerts  
- Automated submission to Google

## Conventions

- Keep API keys in `.env.local`; NEVER commit them. Add `.env*` to `.gitignore`.  
- Prefer simple, readable code with plain-language comments.  
- Commit frequently; push to GitHub each session.  
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
- Without Tower CLI: `BUSINESS_URL=<URL> python3 pipeline/task.py`
- See `pipeline/README.md` for the full integration guide and parity notes with the web app.

Web app -> Tower integration:

- `POST /api/analyze-tower` — triggers a deployed Tower run for the given URL, returns `run_seq` immediately
- `GET /api/analyze-tower/[runSeq]` — polls the run's status; once terminal, returns the extracted `AnalyzeResponse`
- UI: the "Deep scan via Tower" button under the form drives the trigger + poll flow client-side
- Server-side env vars needed: `TOWER_API_KEY` (sk-...) and `TOWER_APP_NAME` (defaults to `ghost-reviews-pipeline`)
- `pipeline/task.py` emits a `__GHOST_RESULT__:{...}` sentinel line so the TS side can extract the structured report from Tower's stdout logs deterministically

## Submission checklist (by June 10, 10:00 AM ET)

- [x] Working live demo URL (Vercel): https://ghost-reviews-ten.vercel.app/  
- [ ] 2–3 min demo video (public YouTube/Loom link)  
- [ ] README: what it does \+ setup steps  
- [ ] Devpost project created and tagged to Nimble \+ Tower \+ name.com challenges  
- [ ] "Built With" lists all sponsor tech
