# ghost.reviews — Tower pipeline

A [Tower](https://tower.dev) app that runs the ghost.reviews scrape → analyze pipeline as a serverless Python job.

This is the **batch / pipeline-mode** version of what the Next.js [`/api/analyze`](../src/app/api/analyze/route.ts) route does interactively. Same Claude model, same system prompt, same fraud-signal taxonomy, and a matching output schema (Zod on the TS side, JSON Schema here). The web app gives an end user an instant report; this pipeline is the runtime built for orchestration (scheduled scans, bulk runs across many businesses, CI-style fraud monitoring).

## What it does

Takes a Google Business Profile URL as a parameter, loads recent public reviews, analyzes them for coordinated-attack signals using Claude, and prints the structured authenticity report to stdout as JSON.

Reviews come from the **Nimble** API when `NIMBLE_API_KEY` is set in the environment. Without that key the pipeline falls back to the bundled `mock_reviews.json` sample dataset so it can still run end-to-end for development and verification.

## Modes

| Mode | When | Behavior |
| --- | --- | --- |
| **live** | `ANTHROPIC_API_KEY` is set in the environment | Calls Claude (Anthropic) with adaptive thinking + structured outputs + prompt caching |
| **stub** | No `ANTHROPIC_API_KEY` set | Returns the canned `mock_report.json`. Lets the pipeline run end-to-end without burning tokens, useful for verifying Tower deploy/wiring. |

## Prerequisites

- Python 3.11+
- A Tower account ([sign up](https://tower.dev))
- An Anthropic API key ([console](https://console.anthropic.com)) — for live mode

## Local run

```bash
cd pipeline
pip install -r requirements.txt
pip install -U tower
tower login  # one-time
tower run --local --parameter business_url=https://maps.app.goo.gl/example
```

To run **without** the Tower CLI (plain Python):

```bash
cd pipeline
pip install -r requirements.txt
BUSINESS_URL=https://maps.app.goo.gl/example python task.py
# Or with live Claude analysis:
ANTHROPIC_API_KEY=sk-ant-... BUSINESS_URL=https://maps.app.goo.gl/example python task.py
```

The pipeline prints a single JSON object to stdout. Pipe it to `jq` for pretty inspection:

```bash
... | jq '.report.overall_risk_score, .report.summary'
```

## Deploy to Tower Cloud

```bash
cd pipeline
tower deploy

# Set the Anthropic key as a Tower secret (one-time):
tower secrets create ANTHROPIC_API_KEY --value "sk-ant-..."

# Run on Tower Cloud:
tower run --parameter business_url=https://maps.app.goo.gl/example

# Inspect:
tower apps show ghost-reviews
tower apps logs ghost-reviews
```

## File layout

| File | Purpose |
| --- | --- |
| `task.py` | The pipeline entrypoint Tower runs |
| `Towerfile` | Tower app manifest: name, entrypoint, source files, parameters |
| `requirements.txt` | Python deps (just `anthropic`) |
| `mock_reviews.json` | Sample review dataset used when `NIMBLE_API_KEY` is unset (shared with the web app) |
| `mock_report.json` | Canned analysis result used in stub mode |

## Parity with the web app

The system prompt, analysis framework, and report schema are kept in lockstep between this Python pipeline and the Next.js app. The prompt text in `SYSTEM_PROMPT` here matches the one in [`src/lib/anthropic.ts`](../src/lib/anthropic.ts), and the JSON Schema in `ANALYSIS_REPORT_SCHEMA` encodes the same shape as the Zod schema in [`src/lib/analysis-schema.ts`](../src/lib/analysis-schema.ts) — Zod and JSON Schema in their respective formats. If you modify the analysis behavior, update both — there's no shared source of truth yet (intentional: keeping the surfaces decoupled for the MVP). The bundled `mock_reviews.json` and `mock_report.json` ARE shared — the Next.js app imports them directly via [`src/lib/mock-data.ts`](../src/lib/mock-data.ts).

## Web app integration

The Next.js app's **"Deep scan via Tower"** button invokes this pipeline via Tower's Control Plane API. Flow:

1. `POST /api/analyze-tower` triggers a run via `POST https://api.tower.dev/v1/apps/ghost-reviews/runs`
2. Browser polls `GET /api/analyze-tower/[runSeq]` every ~2.5s
3. Each poll calls Tower's `GET /apps/.../runs/{seq}` for status and (once terminal) `GET /apps/.../runs/{seq}/logs` for stdout
4. The TS side scans the log lines for the `__GHOST_RESULT__:{...}` sentinel emitted by `task.py` and parses the embedded JSON

The integration requires the following env vars on the Next.js side (set in Vercel for production):

- `TOWER_API_KEY` — your Tower API key (get one at https://app.tower.dev → team settings → API Keys)
- `TOWER_APP_NAME` — defaults to `ghost-reviews` (matches `[app].name` in the Towerfile)

## Roadmap

- [x] Replace `mock_reviews.json` with a live scrape step using the Nimble API (now gated on `NIMBLE_API_KEY`)
- [ ] Add a scheduled-run example (`tower schedules create ...`) for periodic monitoring
- [x] Wire the Next.js API route to invoke this Tower app for "deep scan" requests

---

## prospect.py — outbound prospect pre-filter

`pipeline/prospect.py` is **Stage 1** of the two-stage review-bombing detection funnel.  It is the cheap heuristic that narrows a long list of businesses down to a handful of candidates, which are then verified by Claude (Stage 2 — the web app or `task.py`).

> **The engine belongs in git; the targets do not.**
> Never commit result files — they name businesses you suspect are under attack, and the repo is effectively public.  All output goes to `/tmp` (or a path you choose with `--out`).

### What it is (and is NOT)

- It scores businesses on review *metadata* (timing, reviewer history, star distribution) via the Outscraper API.  **No Claude calls.**
- It is NOT a verifier.  A candidate score of ≥ 50 means "worth Claude's time", not "this is a fake attack".  Always run Claude verification before any outreach.
- Pre-filter precision from live testing was ~33% (2 leads in 6 candidates).  That is fine and expected — improve it by making Claude verification cheaper, not the pre-filter stricter.

### Prerequisites

No extra pip dependencies beyond what is already in `requirements.txt`.  The script uses only Python stdlib (urllib, concurrent.futures, argparse, csv, json, datetime).

Set the following environment variable:

| Env var | Required | Notes |
| --- | --- | --- |
| `OUTSCRAPER_API_KEY` | Yes | Your Outscraper API key — get it at https://app.outscraper.com/profile |

### Input file format

One business per line.  Accepts either a Google Maps URL or a `Business Name, City` string.  Blank lines and `#` comments are ignored.

```
# London ON prospects — June 2026
Vanity House, London ON
https://www.google.com/maps/place/Ricky+Ratchets+Auto+Service/...
# Another Hair Salon, London ON
```

### Standard run

```bash
# Basic: pull 75 reviews per business, 4 parallel workers, output to /tmp
python3 pipeline/prospect.py --input /tmp/my_businesses.txt

# Custom depth and output path (keep outputs out of the repo)
python3 pipeline/prospect.py \
  --input /tmp/my_businesses.txt \
  --depth 100 \
  --workers 8 \
  --out /tmp/prospect_results_2026-06.json
```

Output: a JSON file of candidates sorted by score, plus a `.csv` alongside it, plus a summary table printed to stdout.  Each candidate record includes:

- total score + per-rule breakdown
- the specific reviews that triggered each signal (id, rating, timestamp, reviewer history, text snippet)
- the raw counts (burst window negatives, tightest cluster gap in minutes, etc.) so you can sanity-check before handing to Claude

### Discovery mode (auto-generate the business list)

Instead of `--input` (a list you supply), use `--discover` to **search Google Maps** for businesses by category + city, then score each — the top of the funnel in one command.

```bash
python3 pipeline/prospect.py \
  --discover "auto repair, London, Ontario, Canada" \
  --discover-limit 50 \
  --region CA \
  --min-reviews 20 \
  --depth 75 \
  --out /tmp/auto_london.json
```

- `--discover-limit` — how many businesses to pull (Outscraper `organizationsPerQueryLimit`, default 50).
- `--region` — ISO-3166 alpha-2 bias (default `CA`).
- `--min-reviews` — skip businesses below this total-review count (tiny businesses rarely host a real attack pattern; default 0).
- Writes the full discovered list to a `*_discovered.json` sidecar beside `--out`, and the scored candidates to `--out` (each enriched with the business name / address / site).
- Costs ~$3 / 1,000 businesses (first 500/month free) — negligible at prospecting volume.
- `--discover` and `--input` are mutually exclusive; `--depth-sweep` is for `--input` only.

### Depth-sweep calibration mode

When you want to know at what depth attack signals first appear and where the score stabilises, use `--depth-sweep`.  Instead of a candidate list it scans each business at depths 25 / 50 / 75 / 100 / 150 and prints a per-business table.

```bash
python3 pipeline/prospect.py \
  --input /tmp/my_businesses.txt \
  --depth-sweep \
  --out /tmp/sweep_results.json
```

From live testing: real attack signals were invisible at depth 10 but appeared clearly at depth 50.  Use standard depth ≥ 75.

### Scoring rules (v2)

| Rule | Points | Type | Fires when |
| --- | --- | --- | --- |
| BURST | +40 | Anchor | ≥ 3 negative (≤ 2★) reviews in any 14-day window **and** the count is ≥ 3× the expected baseline rate (velocity-normalised to avoid flagging high-volume businesses) |
| SPIKE | +40 | Anchor | ≥ 3 one-star reviews in any 7-day window **and** the all-time 1★ share is < 20% |
| THROWAWAY | +20 | Corroboration | ≥ 2 recent negatives from accounts with ≤ 2 lifetime reviews — **only** when an anchor already fired |
| TEXTLESS | +15 | Corroboration | ≥ 1 empty/near-empty (≤ 3 words) 1★ review from a low-history account — **only** when an anchor fired |
| TIGHT_CLUSTER | +15 | Corroboration | ≥ 2 negatives posted within 60 minutes — **only** when an anchor fired |

A business is a **candidate** when total score ≥ 50.  Without at least one anchor (BURST or SPIKE), the score is forced to 0 regardless of corroboration — this was the key lesson from v1 live testing.

### Flywheel store (`--db`)

Every run records each scanned business (candidates **and** misses) to a local SQLite store — the growing, outcome-labeled dataset we use to refine the algorithm over time (see [`docs/METHODOLOGY.md`](../docs/METHODOLOGY.md)). It also logs each suspicious reviewer's `author_id`, so the same account flagged across **multiple** businesses surfaces for free — no extra API calls.

```bash
# Recording is on by default (path: pipeline/prospect_store.db, gitignored).
python3 pipeline/prospect.py --discover "auto repair, London, Ontario" --out /tmp/r.json

# See what's accumulated — counts + recurring-author convergence (no scan, no key):
python3 pipeline/prospect.py --db-stats

# Custom store path, or disable recording entirely with --db ''
python3 pipeline/prospect.py --input /tmp/biz.txt --db /tmp/run.db
```

The DB is **gitignored** (`*.db`) — it contains target business data and must never be committed.

### Operational rules

- **Never outreach based on prospect.py output alone.**  Always run Claude verification first.
- **Never commit result files to the repo.**  Keep CSVs and JSONs in `/tmp` or Devon's private notes.
- Output path defaults to `/tmp/prospect_results.json`.  If you override `--out`, keep it outside the repo.
