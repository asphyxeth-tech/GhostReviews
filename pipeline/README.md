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
