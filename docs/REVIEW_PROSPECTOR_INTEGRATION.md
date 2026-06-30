# Review Prospector → Ghost Reviews — Integration & Combined Methodology

_Living design doc. Last updated 2026-06-30. No secrets, no named prospect
lists belong here (the repo is effectively public)._

## What this is

Devon built a second system — **Review Prospector** — a free, multi-city,
**time-series** review-bomb *discovery* engine (local Python + per-city SQLite +
a daily Windows task). This doc is the plan to fold its value into **Ghost
Reviews** (the Vercel + Supabase web app), and the **combined detection
methodology** that came out of a red-team of both systems.

The one-line thesis: **Prospector is the cheap free SCOUT that finds candidates
across whole cities; Ghost Reviews is the JUDGE that confirms them** (deep
Outscraper pull → v2 scorer → Claude content-verify → file → bill). Folding them
together gives a scout-then-judge funnel neither half has alone.

## Combined detection methodology (the funnel)

Stages, and which system owns each:

1. **Watchlist (Prospector, free)** — small/closeable businesses + previously-clean ones.
2. **Discover (Prospector + GR, free)** — free *tiled* Google Places sweep (beats the
   60-result cap by splitting into sub-niches); snapshot each business's rating + count.
3. **Triage / rank (Prospector, free)** — **DELTA** (rating dropped from its peak = a
   live bomb in progress) pushes a business to the front of the scan queue. Reviewer
   overlap with known serial bombers bumps it too.
4. **Deep pull — the ONE paid step (GR)** — for the top of the queue, buy a deep
   **negatives-only** Outscraper pull (75–100 deep; the textless/tight-cluster tells are
   invisible at depth-10).
5. **Score (GR)** — the single existing v2 scorer (`src/lib/prospect-scoring.ts` ↔
   `pipeline/prospect.py`, lockstep). A negative **BURST/SPIKE** is the required anchor;
   THROWAWAY / TEXTLESS / TIGHT_CLUSTER corroborate, plus two **new** Prospector-derived
   corroboration signals: serial-bomber **RING** and **duplicate-text**.
6. **Claude content-verify (GR) — the final, un-bypassable gate** — Claude reads the
   actual review words; specific, checkable complaints ("waited 90 min on Mother's Day")
   are refused as attacks. This kills the honest-bad-week false positives.
7. **Rank survivors (Prospector)** — winnability orders the Claude-passed leads by
   closeability.

### THE ONE RULE THAT MATTERS MOST
> Prospector's rating signals (**DELTA** and **STATIC**) and **winnability** may decide
> *who gets looked at and in what order*. They may **NEVER** add points toward the
> "this is an attack" verdict, and **NEVER** lower the bar for Claude's content check.
> A rating drop tells you *where to look*, not *what you found*. The only thing that
> certifies an attack is the velocity-checked scorer **plus** Claude reading the words.
> (Enforced in code: the scorer zeroes any business with no burst/spike anchor —
> `prospect-scoring.ts:251` / `prospect.py:804`.)

## Red-team result (the honest part)

A 13-agent red-team designed the combined funnel and adversarially ran it against the
documented case battery. **Score: 5/7.** Promising, not done.

| Case | Expected | Combined funnel | |
|---|---|---|---|
| peppermoon (holiday burst, 4.7★/864) | NO-FLAG | NO-FLAG | ✅ |
| Reliance HVAC (~13k reviews) | NO-FLAG | NO-FLAG | ✅ |
| McKenzie Lake (chronic-low law firm) | NO-FLAG | NO-FLAG | ✅ |
| Two Small Men (lone throwaways) | NO-FLAG | NO-FLAG | ✅ |
| Vanity House (verified real lead) | FLAG | FLAG | ✅ |
| **Ricky Ratchets** (verified real lead) | FLAG | **NO-FLAG** | ❌ |
| **Laniakea** (first confirmed attack) | FLAG | **UNCERTAIN** | ❌ |

All four false-positive traps pass (Claude content-verify + velocity normalization).
Both failures are **real verified attacks we'd miss**, and both have the same lesson:
**the naive "only deep-scan businesses whose rating visibly dropped" design throws away
small/fast/textless attacks — exactly the most reliable real-lead type.**

### The two fixes (REQUIRED before launch — pending Devon's sign-off + `detect.py`)
Both modify the v2 lockstep scorer / the triage gating, so they are **not yet applied**
— they need Devon's go and the real thresholds from `detect.py`.

1. **Allow tiny tight textless clusters to alarm.** The scorer requires 3+ reviews to fire
   an anchor, so every **2-review** attack (Ricky Ratchets) is invisible. Fix: a sub-hour
   cluster of **2** negatives becomes an anchor **only when** it co-occurs with textless /
   throwaway / a confirmed serial-bomber. Two organic 1-stars 26 min apart on a sleepy shop
   is itself improbable; Claude still has the final say. **Most important fix.**
2. **DELTA ranks, never gates.** Gating the paid pull on a visible rating drop never scans a
   4-review burst (Laniakea — too small to move the displayed stars). Fix: keep a scheduled
   scan path alive in parallel; DELTA only moves businesses to the *front* of the queue.

### Anti-false-positive guard matrix
| Trap | Caught by |
|---|---|
| Event-driven cluster (bad week) | Claude content-verify (specific complaints → refused) |
| Volume artifact (high-traffic) | velocity normalization in the scorer |
| Lone low-history reviewers | anchor gate (throwaway is corroboration only) |
| Chronic-low rating (industry) | STATIC never scores; Claude verify |

## Where it runs (deployment)

Vercel can't host the local Python + SQLite + Windows-scheduler as-is (no persistent FS,
short-lived functions, Node-not-Python runtime, no scheduler). Recommended path — **no
throwaway work**:

- **Now:** keep the local engine running on Devon's PC (free; keeps accumulating the
  time-series moat — DELTA needs accrued daily history to fire).
- **Build (medium-term):** port the deterministic logic to TypeScript in Ghost Reviews
  (the scorer is *already* TS at `prospect-scoring.ts`; free discovery is *already* TS at
  `google-places.ts`), run the daily `advance` via **Inngest / Vercel Cron** → Supabase.
  Then cut over and optionally import just the (hashed) reviewer graph by CSV.

## Data model (this migration: `0009_prospector.sql`)

New Supabase tables mirroring the engine's SQLite schema, unified on `place_id`, RLS-on /
no-policies / service-role only:
- `prospector_businesses` — canonical business registry (+ city/region cohort keys).
- `prospector_snapshots` — cheap rating+count **time-series** (stores the RATING, with a
  real `captured_at` so DELTA uses true elapsed time).
- `prospector_flags` — DELTA / STATIC discovery candidates (status: new→queued→scanned→
  cleared/lead).
- `prospector_deepdives` — aggregate paid-pull results (counts only, **no review text**).
- `prospector_reviewers` + `prospector_reviewer_hits` — the cross-business serial-bomber
  graph, **hashed ids + counts only** (one global table; the value is cross-city).
- `prospector_markets` + `prospector_tiles` — multi-city registry + tile rotation/saturation.
- `prospector_api_usage` — the **cost guard** ledger (monthly Google free-event budget +
  Outscraper); checked before spending, over-budget = no-op.

Flags feed the **existing** admin → Claude-verify packet → FilingTracker → BillingPanel
workflow (join by `place_id`), so Devon's day-to-day is unchanged. The existing
`prospect_scans` table stays as the paid confirmation layer.

## Ground truth from Devon's real DBs (London/Mississauga/Toronto/Windsor/Brampton, 2026-06-30)
- ~2,296 businesses, ~2,426 snapshots, **90 flags — ALL `static`, 0 `delta`** (the
  time-series hasn't accrued; delta can't fire on ~1 snapshot/business yet).
- **52% of London tiles maxed at the 60-cap** → the tiling win is real and large; Ghost
  Reviews' current discovery silently misses ~half of dense niches (its per-vertical basket
  in `discover/route.ts` broadens across niches but never sub-splits a single saturated one).
- `reviewers` / `deepdives` = **0 rows** — the graph is dormant (no paid deep-dive run yet).
- Reviewer storage is **hash + counts only, no names/text** — confirms the engine's
  PII-clean posture (and the template to fix GR's raw-PII in `prospect_scans`).

## Guardrails to preserve
- **Cost guard** (this migration's `prospector_api_usage`) — check before every paid/budgeted call.
- **PIPEDA minimization** — hash reviewer ids; do NOT persist reviewer names or review text.
  (GR currently violates this in `prospect_scans.flagged_reviews` — fix while folding in.)
- **Canadian privacy-lawyer GATE** — a one-time review before scaling outreach / the graph
  past the London test market. Currently unrecorded; treat as blocking.
- **Don't build the "monitor SaaS" trap** — Google's Apr-2026 update auto-detects review
  spikes + alerts owners for free. Paid value = the DFY concierge filing + the cross-city
  graph, NOT "we'll watch for spikes." (Revisit CLAUDE.md lines 17 & 209.)
- **Claude content-verify stays the terminal gate** — never weakened in any tuning session.
- Outreach: CASL suppression list + pre-send check already in GR — keep.

## Open questions / what's needed to finalize
Need Method B's source (not yet received) to set exact numbers, not guess:
- `detect.py` — DELTA's peak/drop + velocity math; STATIC peer-cohort definition; winnability formula.
- the reviewer-graph + duplicate-text modules — RING thresholds; the hashing scheme/salt;
  the near-dup similarity metric.
- `places.py` — the exact sub-niche refiner heuristic (to wire tiling that matches the
  battle-tested local behavior rather than a guess).
Then **calibrate against labeled outcomes** (which prospects became real leads vs. cleared),
not eyeballs. And confirm DELTA's resolution limit (how big a burst must be to move a
displayed star rating) — which fixes how many real attacks must stay reachable via the
parallel scheduled-scan path.

## Phased rollout
1. ✅ **Schema** (this migration) + this doc.
2. **Discovery upgrade** — tiling past the 60-cap behind the existing `discoverBusinesses()`
   signature (needs `places.py`). Immediate win even before the time-series.
3. **Time-series + DELTA/STATIC/winnability** in TS, daily via Inngest/Vercel Cron → Supabase.
4. **Reviewer graph** (hashed) supersedes the Phase-1 `recurring_authors` convergence helper
   (today a local-only / read-time version in `datastore.py` + a slow JSONB scan in
   `api/admin/scans`); optional CSV import of the existing hashed graph.
5. **The two scorer fixes** (with Devon's sign-off + `detect.py` thresholds) + privacy hashing of `prospect_scans`.
6. **Gated:** privacy-lawyer review before scaling outreach past London; pricing pivot away from monitor-SaaS.
