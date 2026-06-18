# Ghost Reviews — Detection Methodology & Data Flywheel (`docs/METHODOLOGY.md`)

The living reference for *how we decide a business is being review-bombed* — the
scoring model, the feature roadmap, how we validate it, and the proprietary
dataset ("flywheel") that lets us refine it over time. Pairs with
`docs/OUTREACH.md` (what we do once we've found a lead).

> Grounded in two 2026 research passes (academic fake-review-detection literature
> + a data-source survey). Sources are linked inline. This is a living doc —
> update it whenever the model or the validation changes.

---

## 0. Why this doc exists (the moat)

**There is no public, labeled dataset of coordinated fake-review attacks on
*Google* Business Profiles** with timestamps + reviewer metadata. Google's
removal system is opaque — unlike Yelp, there is no "filtered reviews" feed to
learn from. So the only way to truly validate and out-tune a Google-specific
detector is to **build our own labeled dataset**: every business we scan → what
our algorithm scored → whether it was actually an attack → whether they
converted. That accumulating, outcome-labeled record is the **data flywheel**,
and it's the durable moat (the heuristic is copyable; the data isn't).

---

## 1. The detection model (current — v2)

Implemented in `pipeline/prospect.py` (Stage 1 pre-filter). The pre-filter
NARROWS; Claude content-analysis VERIFIES (Stage 2). Never email off the
pre-filter alone.

**Anchors (required — no anchor ⇒ score 0):**
- **BURST** (+40): ≥3 negatives (≤2★) in any 14-day window, **velocity-
  normalized** (only fires if ≥3× the business's expected negatives-per-window
  rate — kills volume artifacts on high-traffic businesses). ✅ *shipped*
- **SPIKE** (+40): ≥3 one-star in any 7-day window when all-time 1★ share < 20%.

**Corroboration (only with an anchor):** THROWAWAY (+20, ≥2 negatives from ≤2-
lifetime-review accounts), TEXTLESS (+15, ≥1 empty 1★ from a low-history
account), TIGHT_CLUSTER (+15, ≥2 negatives within 60 min). Candidate ≥ 50.

We do **not** score chronic-low ratings (industry/quality signal, not an attack).

---

## 2. Feature roadmap

All computable from fields Outscraper already returns (`review_datetime_utc`,
`review_rating`, `reviews_count`, `author_reviews_count`, `review_text`,
`autor_id`) — no new API calls.

| Feature | Status | Notes |
|---|---|---|
| Velocity-normalized burst | ✅ shipped | The literature's #1 cited gap — we're ahead of it |
| Singletons / textless 1-stars | ✅ shipped | Empirically our strongest real-lead signals |
| **IAT within burst** | ⬜ to add (~30m) | Min minutes between consecutive negatives (the "26 min apart" signal); sharpens TIGHT_CLUSTER |
| **Rating entropy in burst window** | ⬜ to add (~45m) | Shannon entropy of ratings during the burst — a pure 1★ flood = 0; mixed legit complaints = high. Low entropy + 1★ spike = coordinated |
| Reviewer footprint / EXT | ⬜ phased | See §3 |
| Co-reviewer network | ⬜ Phase 2 | Strongest academic signal (He et al. 2022, [PNAS](https://www.pnas.org/doi/10.1073/pnas.2211932119): AUC 0.879 from 2 graph features) — enabled by the flywheel |

**Tune with data, not vibes.** Per CLAUDE.md and the validation method below,
every threshold/feature change must beat the prior version on the calibration
set before it ships.

---

## 3. Reviewer-account analysis (the "is this account a serial bomber?" signal)

A suspicious reviewer's *full history is public*. Two validated signals:
- **Behavioral footprint** — are this account's *other* reviews also bombs?
- **Extreme Rating Bias (EXT)** — does it *only* leave 1★ or 5★ (no nuance)?
  (Mukherjee et al., [KDD 2013](https://dl.acm.org/doi/10.1145/2487575.2487580).)

Built in two phases so we get the cheap 80% for free:

- **Phase 1 — FREE, via the flywheel.** We log `author_id` on every scanned
  review (see §4). Then, with pure local SQL: (a) **cross-business convergence**
  — the same account flagged across multiple businesses we've scanned, and
  (b) the account's **rating pattern across the data we already collected**.
  Zero extra API cost; grows with the store.
- **Phase 2 — on-demand full-history lookup.** For a suspicious account we
  haven't seen elsewhere, fetch its *full* public review history to compute true
  EXT / "all bombs". High signal, low cost (runs only on the few suspicious
  accounts on candidate businesses). **Rule: fetch via a vendor endpoint, NEVER
  hand-rolled contributor-page scraping** — that would re-introduce the exact
  brittleness we left Nimble to escape. (No official Google API exists for
  reviews-by-reviewer; confirm a robust vendor path before building.)

---

## 4. The data flywheel (local-first store)

`pipeline/datastore.py` — a local **SQLite** file (stdlib, zero infra), the
proof-of-concept home for the dataset. Graduate to Supabase when volume warrants.
**The DB is never committed** (gitignored — it contains business/target data).

**Schema:**
- `scans` — one row per business scanned: `place_id`, `business_name`, `query`,
  `total_reviews`, `scan_depth`, `prefilter_score`, `anchor_fired`,
  `rules_fired`, `counts`, `scanned_at`, and the *labels we backfill over time*:
  `outcome_label` (real_attack / clean / unknown), `claude_verified`,
  `outreach_status`. **`prefilter_score` paired with `outcome_label` IS the
  training/validation set.**
- `flagged_reviews` — the suspicious reviews that drove each score, incl.
  `author_id` (enables §3 Phase-1 convergence), rating, timestamp, reviewer
  history, textless flag.

We record **every** scanned business (candidates *and* misses) — the negatives
are required for the PR-AUC calibration in §5.

`prospect.py --db-stats` prints accumulated counts + recurring-author
convergence so the flywheel is visible as it grows.

---

## 5. Validation methodology

- **Use PR-AUC, not ROC-AUC.** Attacks are rare (<5% base rate); ROC-AUC flatters
  imbalanced data. ([why](https://machinelearningmastery.com/roc-curves-and-precision-recall-curves-for-imbalanced-classification/))
- **Operating target: ≥80% precision @ 0.5 recall** before scaling outreach. Our
  funnel's ~33% post-Claude precision (2 of 6) is fine — the pre-filter's job is
  to narrow cheaply, not to be precise.
- **Method:** the flywheel's `prefilter_score` vs. `outcome_label` *is* the
  calibration set. Plot the PR curve, set the threshold, and re-check PR-AUC each
  time we add a feature (§2) to prove it helped.
- **External benchmark:** once obtained, reconstruct burst sequences on **YelpCHI**
  and label a business "attacked" if ≥3 platform-filtered reviews fall in any
  14-day window (mirrors our BURST) → a baseline PR-AUC to beat.

---

## 6. Datasets to obtain (for benchmarking)

1. **YelpCHI / YelpNYC / YelpZip** (Rayana & Akoglu, [shebuti.com](https://shebuti.com/yelpchi-dataset/)) — **rank 1**, has timestamps + ratings + platform-filter labels. Email `srayana@cs.stonybrook.edu` (~1-2 wk). *Caveat:* no reviewer account-age fields.
2. **He et al. Amazon** ([GitHub](https://github.com/bretthollenbeck/fake-reviews-data)) — best ground truth (direct observation), open access; for the co-reviewer network features (Phase 2).
3. **Skip** Ott/OpSpam + Kaggle synthetic sets — no timestamps, text-only, useless for our behavioral heuristic.

---

## 7. Data sources (verdicts)

- **Use now (cheap/CASL-safe):** Outscraper *Emails & Contacts* enrichment (business-published emails only, on verified leads), **Overpass/OSM** (free discovery pre-screen), **Google Alerts** (on verified prospects).
- **Defer:** DataForSEO Maps SERP ($0.60/1k — 5× cheaper than Outscraper *at scale*; the alternative if Outscraper gets flaky); Bing News; Google Trends alpha (apply now, free).
- **Avoid:** Apollo / Hunter *Email Finder* / RocketReach (inferred emails → CASL exposure); Yelp Fusion; Twitter/X; BBB scraping. There is **no reliable leading "at-risk" signal** for small markets — don't pay noisy news/social APIs chasing one; the two-stage funnel is already correct.

---

## 8. Operating principles

1. **Calibrate, don't guess.** Every scoring change proves itself on the
   calibration set first.
2. **Two-stage funnel is the product.** Pre-filter narrows (cheap); Claude
   verifies (cents). Don't make the pre-filter the verifier.
3. **Cost discipline (pre-validation).** Free tiers + targeted enrichment only.
4. **The flywheel compounds.** Every scan + outcome makes the next decision
   better. Log everything (locally); label outcomes as they resolve.
