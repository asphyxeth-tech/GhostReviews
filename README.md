# ghost.reviews

**Catch the ghosts haunting your Google reviews.**

ghost.reviews is a B2B web app that helps local business owners detect coordinated, fraudulent review attacks ("review bombing") on their **Google Business Profile**, produces a transparent evidence report, and drafts an official **policy-violation removal request** they can submit to Google.

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
git clone https://github.com/asphyxeth-tech/DeveloperWeek2026Hackathon.git
cd DeveloperWeek2026Hackathon
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
| `TOWER_API_KEY` | Optional | The "Deep scan via Tower" button errors out. The instant `/api/analyze` route still works. |
| `TOWER_APP_NAME` | Optional | Defaults to `ghost-reviews` (matches the Towerfile). |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Sign-in and the scan-history dashboard are disabled; anonymous scans work as always. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Same as above — both Supabase vars must be present together. |

**Never commit `.env*` files** — they're gitignored.

For the Python pipeline, see [`pipeline/README.md`](./pipeline/README.md).

### Supabase setup (accounts + scan history)

Customer accounts (magic-link email sign-in) and the scan-history dashboard
are powered by Supabase. One-time setup:

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Open **SQL Editor → New query**, paste the contents of
   [`supabase/migrations/0001_scans.sql`](./supabase/migrations/0001_scans.sql), and **Run**.
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

The system is designed to degrade honestly rather than fail. With **no keys**, the demo flow runs against the bundled sample dataset and a canned report — useful for screenshots and stakeholder demos. With **just `NIMBLE_API_KEY`**, the app falls back to the canned demo (Nimble is only called when there's a Claude key to actually analyze the live batch). With **just `ANTHROPIC_API_KEY`**, the app runs live Claude analysis on the bundled sample dataset. With **both keys**, the app scrapes live reviews via Nimble and analyzes them with Claude. The UI labels each report with its actual data source ("Live reviews via Nimble" vs. "Demo dataset") so the operator and the viewer always know which path produced what they're seeing.

## Ethical use

ghost.reviews is a tool for owners who have been targeted by **policy-violating** review activity. It is not a tool for hiding honest negative feedback. All output is probabilistic and intended as evidence the owner submits through Google's official channels — we do not, and will not, attempt to delete reviews or game Google's systems.

## License

[MIT](./LICENSE)
