# Ghost Reviews

**Catch the ghosts haunting your Google reviews.**

Ghost Reviews is a B2B web app that helps local business owners detect coordinated, fraudulent review attacks ("review bombing") on their **Google Business Profile**, produces a transparent evidence report, and drafts an official **policy-violation removal request** they can submit to Google.

> **Live:** https://ghostreviews.app/

---

## Why this exists

Fake and planted reviews are now federally illegal in the U.S. under the FTC's Consumer Review Rule (2024), with penalties up to ~$53,000 per violation. A coordinated 1-star "bomb" can tank a small business's revenue overnight. Owners need a fast, transparent way to identify suspicious clusters of reviews and pursue the official removal process — without resorting to anything shady.

## What it does

1. **You paste your Google Business Profile URL** (or business name + location).
2. **We pull recent public reviews** via the Nimble API.
3. **Claude analyzes the reviews** for coordinated-attack signals — timing clusters, low-history reviewer accounts, near-identical phrasing, rating anomalies, vague complaints with no specifics.
4. **You get an authenticity report** — an overall risk score plus a list of flagged reviews, each one with a plain-English explanation of *why* it was flagged.
5. **For each flagged review, you get a drafted removal request** — text you can copy and submit through Google's official policy-violation channel.

Outputs are always framed as **likelihood + transparent reasoning**, never a definitive "this is fake" verdict. We don't delete reviews. We don't automate mass-flagging. We don't help bury honest negative criticism — suppressing legitimate reviews is itself an FTC violation and is firmly out of scope.

## Tech stack

- **[Claude API](https://www.anthropic.com/)** (Anthropic) — fraud-signal analysis and removal-request drafting
- **[Nimble](https://nimbleway.com/)** — live Google review scraping
- **[Tower](https://tower.dev/)** — serverless Python compute for the deep-audit pipeline
- **[Next.js](https://nextjs.org/)** (App Router) + **[Tailwind CSS](https://tailwindcss.com/)** — frontend
- **[Vercel](https://vercel.com/)** — hosting

## Repo layout

```
.
├── src/                    Next.js app (the live web interface)
│   ├── app/                  App Router pages + /api/analyze route
│   ├── components/           UrlAnalyzeForm + AnalysisReport (results UI)
│   └── lib/                  Anthropic client, Zod schemas, mock data
└── pipeline/               Tower app (the batch-mode analysis pipeline)
    ├── task.py               Python entrypoint
    ├── Towerfile             Tower app manifest
    └── README.md             Full setup + deploy guide for the pipeline
```

The web app (Next.js on Vercel) gives end users an instant report. The Tower pipeline runs the same Claude analysis as an orchestration-mode job. The system prompt, analysis framework, and report schema are kept in lockstep between the TypeScript and Python implementations — the prompt text is identical, and the Zod schema in `src/lib/analysis-schema.ts` and the JSON Schema in `pipeline/task.py` encode the same shape in their respective formats. See [`pipeline/README.md`](./pipeline/README.md) for the Tower integration.

## Local setup

**Prerequisites:** Node 20+ for the web app, and Python 3.11+ if you also want to run the Tower pipeline locally.

```bash
git clone https://github.com/asphyxeth-tech/GhostReviews.git
cd GhostReviews
npm install
cp .env.example .env.local   # then open .env.local and fill in your keys
npm run dev                  # serves at http://localhost:3000
```

Other useful scripts:

- `npm run build` — production build (TypeScript + ESLint pass, generates static pages)
- `npm run start` — run the production build locally (after `npm run build`)
- `npm run lint` — run ESLint

**Enable the secret-hygiene pre-commit hook (one-time per clone):**

```bash
git config core.hooksPath .githooks
```

See `SECURITY.md` for the full policy.

### Which environment keys you need

All keys are optional — the app gracefully degrades when one is missing.

| Variable | Required? | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Optional | The app runs in **demo mode**: the analysis step returns a canned report instead of calling Claude. No tokens are burned, and the rest of the flow (UI, validation, schema) is exercised end-to-end. |
| `NIMBLE_API_KEY` | Optional | The app analyzes the bundled `pipeline/mock_reviews.json` sample dataset instead of scraping live Google reviews. |
| `TOWER_API_KEY` | Optional | The "Full audit" button errors out. The instant `/api/analyze` route still works. |
| `TOWER_APP_NAME` | Optional | Defaults to `ghost-reviews` (matches the Towerfile). |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Sign-in and the scan-history dashboard are disabled; anonymous scans work as always. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Same as above — both Supabase vars must be present together. |
| `GBP_MANAGER_EMAIL` | Optional | The Google identity a concierge client invites as a **Manager** on their Google Business Profile. Shown in the onboarding walkthrough + admin panel. **Must be a real, sign-in-capable Google account** (not just an alias) — verify it can actually accept a Manager invite on a test profile *before* using it with a client. Defaults to `devon@ghostreviews.app`. |

**Never commit `.env*` files** — they're gitignored.

For the Python pipeline, see [`pipeline/README.md`](./pipeline/README.md).

### Supabase setup (accounts + scan history)

Customer accounts (magic-link email sign-in) and the scan-history dashboard
are powered by Supabase. One-time setup:

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Open **SQL Editor → New query** and run **every** migration in
   [`supabase/migrations/`](./supabase/migrations/) **in order, 0001 through
   0008** (paste each file's contents and **Run**). All are required for a real
   deploy — they're idempotent, so re-running is safe. What each adds:
   - `0001_scans.sql` — customer scan history (the magic-link dashboard).
   - `0002`–`0003` — the prospect/admin flywheel + per-business metadata.
   - `0004_services.sql` — the cost/subscription registry.
   - `0005_filings.sql` — the removal-request tracker.
   - **`0006_rate_events.sql` — REQUIRED. This is the rate limiter for the public
     `/api/analyze` scan. If you skip it the public scan is UNTHROTTLED — anyone
     can run unlimited scans and run up your Anthropic + Outscraper bills. Do not
     skip this one.**
   - `0007_clients.sql` — onboarded clients + card-on-file state.
   - **`0008_billing_consent_outreach.sql` — enables documented consent capture,
     the Phase-B success-fee billing ledger, and the outreach `suppressions`
     (do-not-contact) list. Required before onboarding any real client or sending
     outreach.**
3. In **Authentication → URL Configuration**, set the Site URL to
   `https://ghostreviews.app` and add these Redirect URLs:
   - `https://ghostreviews.app/auth/callback`
   - `http://localhost:3000/auth/callback`
4. In **Project Settings → API**, copy the **Project URL** and the
   **anon/public key** into the env vars (`.env.local` locally, and
   Project → Settings → Environment Variables on Vercel):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Redeploy. Sign-in appears in the site header; scans run while signed
   in are saved to `/dashboard` automatically.

Without these vars the app behaves exactly as before — anonymous scans,
nothing persisted.

### How it actually runs

The system is designed to degrade honestly rather than fail. With **no keys**, the demo flow runs against the bundled sample dataset and a canned report — useful for screenshots and stakeholder demos. With **just `NIMBLE_API_KEY`**, the app falls back to the canned demo (Nimble is only called when there's a Claude key to actually analyze the live batch). With **just `ANTHROPIC_API_KEY`**, the app runs live Claude analysis on the bundled sample dataset. With **both keys**, the app scrapes live reviews via Nimble and analyzes them with Claude. The UI labels each report with its actual data source ("Live Google data" vs. "Demo dataset") so the operator and the viewer always know which path produced what they're seeing.

## Launch checklist

Before pointing real traffic (or real money) at a deploy:

- [ ] **All Supabase migrations applied, 0001 through 0008** (see above) — in
      particular **0006**, or the public scan is unthrottled.
- [ ] **Hard monthly spend cap set in BOTH the [Anthropic console](https://console.anthropic.com/)
      AND the [Outscraper dashboard](https://outscraper.com/).** This is the real
      backstop: if the in-app rate limiter (0006) is ever misconfigured or fails
      open, these provider-side caps are what stop a runaway bill. Set them low
      and raise deliberately — don't rely on the app limiter alone.
- [ ] `GBP_MANAGER_EMAIL` set to a real, sign-in-capable Google account, and
      verified able to accept a Manager invite on a test profile.
- [ ] Outreach sends from a **separate** subdomain/sibling domain, never the
      transactional `devon@ghostreviews.app` (see `docs/OUTREACH.md` §7a).

## Ethical use

Ghost Reviews is a tool for owners who have been targeted by **policy-violating** review activity. It is not a tool for hiding honest negative feedback. All output is probabilistic and intended as evidence the owner submits through Google's official channels — we do not, and will not, attempt to delete reviews or game Google's systems.

## License

[MIT](./LICENSE)
