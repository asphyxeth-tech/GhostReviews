# Cost Overhaul Plan (toward $0/month)

_Produced 2026-07-01 by a 6-auditor + red-team-critique + synthesis workflow (Claude Fable 5 session).
This is the DECIDED plan, post-red-team: Section 5's rejected ideas stay rejected; Section 7 is the
briefing for the next model. No secrets, no named prospects. Update statuses as items ship._

# Ghost Reviews — Cost Overhaul Plan (toward $0/month)

**Devon — read Section 3 first. Item #1 costs you 15 minutes today, needs no code, and matters more than everything else combined.**

A note on method: six audits and a red-team critique went into this. Where they disagreed on numbers, I anchored on the *measured* figures the critique verified, not the biggest estimates. Where the critique killed a proposal, it stays dead (Section 5). Every claim below is either cited to a file, grounded in the known price facts, or explicitly flagged as "check the dashboard."

---

## 1. Where the money goes today

Your app has two kinds of cost: **variable spend** (per-scan API calls — small today, uncapped in the worst case) and **fixed costs nobody was counting** (subscriptions that exist whether or not anyone scans anything).

### Variable spend (the metered APIs)

| Surface | What it costs now | Arithmetic | Worst case if abused |
|---|---|---|---|
| **Public free scan** (`/api/analyze`) | ~$0.28 per fresh scan | Outscraper: 60 reviews billed (36 newest + 24 negatives, `src/lib/reviews.ts:76-84`) × $3/1k = **$0.18**. Claude Opus 4.8: ~10.5k input tokens × $5/MTok + ~2-4k output × $25/MTok ≈ **$0.10** (measured; the "$0.40-0.70/scan" estimate floating in one audit was ~3× inflated). At ~30-50 scans/mo: **~$10-15/mo** | 200 anon scans/day allowed (`rate-limit.ts:20`) ≈ $56/day ≈ **$1,700/mo** — and the cap is a fiction in two cases: the limiter fails **open** when Supabase isn't wired (`rate-limit.ts:86`), and **any free magic-link account skips rate limiting entirely** (`analyze/route.ts:48`). A scripted free account = unbounded. |
| **Public "Full audit" (Tower)** | Unknown base fee + per-run: 200-review Nimble scrape + Opus at effort *high* (`pipeline/task.py:58, 642-646`) + Tower cloud run ≈ $0.55+/run | Anonymous visitors can trigger it from the homepage button (`UrlAnalyzeForm.tsx`), 50/day globally (`analyze-tower/route.ts:50-53`); signed-in users are **exempt from all throttling** (`route.ts:43-48`) | ~$28+/day ≈ **$840+/mo**, plus: the poll route `GET /api/analyze-tower/[runSeq]` has **no auth check at all** and returns the full paid report — anyone can enumerate the small-integer run IDs and harvest every finished audit. This is simultaneously a cost leak and a free giveaway of the $99 product. |
| **Admin prospecting** (Outscraper deep dives + Google discovery) | **~$0-7/mo** at your real cadence | ~2 sweeps/mo ≈ 2,700 reviews − 500 free × $3/1k ≈ $6.60; Google discovery ≤48 events/sweep sits inside the free tier | The migration-0009 cost-guard ledger (`prospector_api_usage`) exists **only as a database table** — zero lines of app code read or write it (verified by repo-wide grep). Nothing budgets toward the 500 free reviews. The Outscraper Maps-search fallback also fires **silently** if `GOOGLE_MAPS_API_KEY` is ever missing (`admin/discover/route.ts:75-76`). |
| **Nimble (legacy)** | Unknown — fires as a silent fallback on every Outscraper timeout (`reviews.ts:41-45`) and is the *only* source for Tower runs | Unbudgeted, unlogged, latency-unstable per CLAUDE.md | Every 25-second Outscraper hiccup silently spends Nimble credits on a paginated pull |
| **Admin verification packets** | **$0** — already runs as copy-paste packets on your flat-rate claude.ai Max subscription (`src/lib/verification-prompt.ts`) | Confirmed: no other Anthropic call sites exist in `src/` | n/a — this is the model to extend, not a problem |

### Fixed costs nobody was counting (the red-team found these)

| Item | Cost | Note |
|---|---|---|
| Claude Max subscription | ~$100-200/mo | The real price of the "$0 packet layer." Worth it — it's your analysis engine — but it belongs on the ledger. |
| Google Workspace (`devon@ghostreviews.app`) | ~$8-11 CAD/mo | HANDOFF.md:34 |
| iPostal1 mailing address | ~$10-25 USD/mo | CASL-required on every cold email (HANDOFF.md:167). Legally load-bearing. Missing from the `services` cost registry. |
| Vercel | $0 today, **but** | The code self-documents running on Hobby — a Stripe-charging B2B product violates Hobby's non-commercial terms. Budget the forced **$20/mo Pro** upgrade. Also: `maxDuration=300` × heavy scan days risks Hobby *suspension*. |
| Tower + Nimble base plans | **Unverifiable from the repo** | If either has a flat fee, it may be the largest legacy line. Check both dashboards this week (the CostDashboard "manage" links exist for exactly this). |
| Stripe | $0 fixed, but 2.9% + $0.30 ≈ **$3.17 per $99 removal fee** | Bigger than the ~$2/lead data cost. Real COGS; fine, but count it. |

### One honest total

**Variable: ~$15-30/mo today** (dominated by Opus on the free scan). **Fixed: ~$130-260/mo** (Max sub, Workspace, iPostal1, likely Vercel Pro, unknown Tower/Nimble). **Worst-case abuse ceiling: effectively unbounded** — the coded caps allow ~$2,500+/mo, free accounts bypass them entirely, and the dashboard spend caps that `rate-limit.ts:8-9` *documents as the backstop* are still an unchecked box (HANDOFF.md:40).

---

## 2. The target architecture (the $0 funnel)

Plain words, one dollar label per stage. The rule that organizes everything: **a paying client's audit costing $2 is healthy cost-of-goods; a stranger's click costing $2 is a leak. Anything that spends before revenue must be free, cached, or capped.**

1. **Discovery** — your local Prospector's free tiled Google sweeps + the app's Google Places discovery. **$0**, budget-guarded inside the 1,000 free events/month (weekly sweeps per market, not daily — attacks are confirmed downstream, not by snapshots). The paid Outscraper Maps-search fallback: **deleted**.
2. **Triage** — the deterministic v2 scorer (`src/lib/prospect-scoring.ts`) ranks the DELTA/winnability queue. **$0.** DELTA ranks, never gates.
3. **Deep dives** — the ONE recurring paid data step. Negatives-only pulls (`outscraper.ts:257-264`) at depth 75-100, ~20/month, gated by the queue and the wired budget ledger. **~$0-3/mo** — mostly inside Outscraper's 500 free reviews. Depth is not negotiable; this is already the floor.
4. **Verification + outreach drafting** — paste-in packets on the Max subscription (already built, `verification-prompt.ts`). **$0 marginal.** The FTC guardrail (refuse to pitch a clean business) lives in the packet text itself. Never email on scorer output alone.
5. **Public instant scan** — the one Claude API call that must stay automated (an anonymous visitor needs an answer in seconds; no human can be in that loop). Slimmed payload + Sonnet + 24-hour cache: **~$0.10-0.15 per *fresh* scan, $0 per repeat**, hard-capped at the vendor.
6. **Paid one-shot audit** — runs *after payment*, operator-driven (local pipeline run or the Outscraper deep path), Claude API for the deliverable. **~$0.50-1.00 per paying engagement** — that's COGS against $99+, not a leak. Not routed through packets: your time on revenue work is worth more than $0.40 of API.
7. **Monitoring (future, subscribers only)** — incremental diff pulls + free scorer; Claude (Batch API, 50% off) only when something anchors, and **no customer-facing alert ever fires on scorer output alone** — the Claude gate extends to alerts, in writing.
8. **Filing drafts** — generated with the paid audit (revenue-attached API call) or in the packet flow for pre-revenue prospects.

**Honest tradeoffs accepted:** free-scan repeats can be up to 24h stale; the anonymous teaser runs on Sonnet, not Opus; the free scan goes down (honest error) during an Outscraper outage instead of failing over to a paid scraper; there is no anonymous self-serve deep audit anymore; cold-market snapshots are weekly, not daily; you do a 2-5 minute paste per pre-revenue lead. None of these touch the depth-50 rule, the anchor/velocity false-positive guards, or Claude-as-terminal-gate.

**The honest end state is ~$5-15/mo variable** — not literally $0, because the free tiers (500 Outscraper reviews, 1,000 Google events) are each spent *once*, and public scans + admin dives share them. An earlier "$0-8/mo" figure double-booked those tiers; don't anchor on it.

---

## 3. Quick wins — do this week

Ranked by risk-reduction per minute of effort.

1. **Set the vendor dashboard spend caps. Today.** — Anthropic console hard cap ~$25/mo; Outscraper cap ~$15/mo; Google Cloud budget alert + API quota cap. **Saves: $0 in the happy path; converts "unbounded" into "a number you chose" in every bad path.** Effort: 15 min, zero code. This is HANDOFF.md:40's own unchecked box, and `rate-limit.ts:5-9` documents these caps as the intended backstop. Every other number in this plan is soft until this is done. Tradeoff: if a cap is hit, scans show an honest "temporarily unavailable" (the route already handles this gracefully, `analyze/route.ts:63-72`) — correct behavior pre-revenue.

2. **Gate the Tower deep audit — button, POST, *and* GET.** Remove the public "Full audit" button (or require sign-in), require auth on `POST /api/analyze-tower`, and — the part everyone almost missed — add an auth check to `GET /api/analyze-tower/[runSeq]`, which currently returns the full paid report to anyone who guesses a small integer. Also fix the bug where that route saves *someone else's* audit into whichever signed-in user polled it (`saveScanIfAuthenticated` call at the end of the GET handler). **Saves: up to ~$840/mo of abuse ceiling + stops giving away the $99 product.** Effort: ~1 hour. Files: `src/components/UrlAnalyzeForm.tsx`, `src/app/api/analyze-tower/route.ts`, `src/app/api/analyze-tower/[runSeq]/route.ts`. Tradeoff: no free public deep scan — it was cannibalizing the paid tier anyway.

3. **Close the signed-in bypass properly.** Per-user caps alone don't work (free accounts are unlimited — N accounts × cap each = unbounded). The real fix is one structural line: move the **global daily count outside** the `if (!isAuthed)` blocks in `analyze/route.ts:48` and `analyze-tower/route.ts:49`, so *everyone* decrements the same global bucket; add a per-user key (`user:${id}`, e.g. 10-20/day) on top for fairness. Also drop `DEFAULT_GLOBAL_DAILY` from 200 to 50 (`rate-limit.ts:20`) — real traffic is single-digit/day; 50 leaves 5-10× headroom. **Saves: caps the analyze surface at ~$14/day even against account rotation.** Effort: ~1 hour. Tradeoff: a genuine viral day hits the cap — raising it is a one-line deliberate act, which is the point.

4. **Slim the Claude payload.** `anthropic.ts:84` sends `JSON.stringify(reviews, null, 2)` — pretty-printed, and every review carries a ~150-char `review_link` URL and a 21-digit `author_id` the model never uses (the output schema echoes neither). Measured: 60 reviews drop from ~9.0k to ~4.5k tokens when stripped and compacted. Map to `{id, reviewer_name, reviewer_total_reviews, rating, posted_at, text}`, no indent; re-join `review_link` server-side by id. Do the identical change in `pipeline/task.py:634` (lockstep rule). **Saves: ~50% of input tokens, ~$5-10/mo now, ~$350/mo off the ceiling.** Effort: 20 min. Tradeoff: none — verifiably zero precision impact.

5. **Stop generating removal drafts for anonymous scans — but keep the reasoning.** `analyze/route.ts:109-111` strips all per-review detail for anonymous users *after* paying Opus output rates ($25/MTok) to write ~200-word removal drafts per flag. Thread `isAuthed` into `analyzeReviewsWithClaude` and make `removal_request_draft` optional/skipped for anonymous calls. **Important nuance from the red-team: do NOT drop the per-review `reasoning` field** — requiring the model to justify each flag is part of what keeps the flag count honest, and the count is exactly what anonymous owners see. **Saves: ~50% of output tokens on anonymous scans, ~$3-8/mo.** Effort: 1-2 hours. Files: `src/lib/anthropic.ts`, `src/lib/analysis-schema.ts`, `src/app/api/analyze/route.ts`.

6. **Delete the Nimble fallback.** `reviews.ts:41-45` silently spends Nimble credits on every Outscraper timeout. Remove the fallback (the route already returns an honest 502 on an empty scrape, `analyze/route.ts:84-92`), remove `NIMBLE_API_KEY` from Vercel, keep the `deriveSearchQuery` helper (move it out of `nimble.ts`). **Saves: an entire unbudgeted paid vendor.** Effort: ~1 hour. Tradeoff: an Outscraper outage means "try again" instead of a degraded scan — the right posture at $0 revenue.

7. **Delete the paid discovery fallback.** `admin/discover/route.ts:75-76` silently switches to paid Outscraper Maps search on a missing env var. Make Google mandatory; error loudly if the key is unset. Delete `outscraper-search.ts` and the `--discover` path in `prospect.py` (your local Prospector's tiled sweep is better anyway). **Saves: prevents accidental spend (~$0 today, real money the day an env var typos).** Effort: ~1 hour.

8. **Small honest cleanups.** (a) Drop `pipeline/task.py` effort from `high` to `medium` (matches the web path) for however long Tower survives — 5 min. (b) Delete the "prompt caching" claim from `pipeline/README.md`: the ~1.0k-token system prompt is below the 4,096-token cache minimum on Opus 4.8, so the `cache_control` marker at `anthropic.ts:100` is a silent no-op — it costs nothing but saves nothing, and budgeting as if it caches is wrong. Caching is a closed topic at these prompt sizes (see Section 5). (c) Check the Tower, Nimble, and Vercel plan dashboards; add iPostal1 + Workspace rows to the `services` cost registry (migration 0004's own "verify" notes are the to-do list).

**Week-one net effect: worst case falls from "unbounded" to ~$40/mo enforced at the vendor; per-scan cost falls ~40%; two legacy paid vendors are on the exit ramp.**

---

## 4. Structural moves — do this month

1. **FIRST, decide the packet-vs-privacy schema conflict (a decision, not code).** Two approved workstreams currently specify opposite schemas: the PIPEDA minimization fix says *stop persisting review text* in `prospect_scans` (`docs/REVIEW_PROSPECTOR_INTEGRATION.md:137-138`), but the $0 verification packet *renders from that stored text* (`verification-prompt.ts:76` uses the 200-char snippets saved at `prospect/route.ts:73`). Strip the text and the packet flow silently degrades to "(no review text)" — useless. The resolution: **build the packet at scan time**, while the full pull is in memory in `prospect/route.ts:37-51`, and persist the *packet text* (an analytic work product containing quotes) instead of a structured review-text table — or explicitly accept a ~$0.05-0.15 re-pull per packet as the price of minimization. Also note: the previously-proposed "deep-audit packet that reuses the stored pull" was built on a false premise — `prospect_scans` stores only *flagged* reviews' snippets, never the full pull. Effort: 30-min decision + ~2-3 hours. **This blocks both the cache work and the privacy work — do it first.**

2. **Cache-first layer, one key, all surfaces.** Today nothing ever reads the store before spending: every repeat scan of the same business re-buys 60 reviews and a fresh Opus call. The cache key already exists *before* any spend: `deriveSearchQuery(input)` (`outscraper.ts:325`) is the exact normalized string sent to Outscraper — cache on it (v1), backfill `place_id` from the response for cross-surface joins (v2). Rules: public scans serve a cached report **≤24 hours** old (not 7 days — see Section 5), timestamp shown, force-refresh for signed-in users; admin prospect scans reuse ≤24h results. Also add the free client-side fix: in the admin deep-dive, **skip re-pulling any candidate whose wide pass returned fewer reviews than the depth asked for** — the negative tail was exhausted; depth 100 cannot return anything depth 50 didn't. **Saves: ~20-40% of all scan volume (repeats are the norm in this funnel: prospect scans own business, retries, you verify, owner scans again), and hammering one URL becomes self-defeating for abusers.** Effort: ~2-3 hours total (the `deriveSearchQuery` insight collapsed the original half-day estimate). Files: `src/app/api/analyze/route.ts`, `src/app/api/admin/prospect/route.ts`, `src/components/AdminDashboard.tsx`, one small migration.

3. **Wire the 0009 cost-guard ledger — for real, all three providers.** `prospector_api_usage` (migration `0009_prospector.sql:180-186`) promises "checked before spending, over-budget = no-op" and is referenced by zero lines of app code. Build `src/lib/cost-guard.ts` with `checkBudget(provider, estimate)` / `recordUsage(provider, actual)` and call it at the top of every paid path: Outscraper pulls (budget 500 reviews/mo), Google Places (budget ~900 events/mo), **and the Anthropic call on the public path** — the red-team showed that a ledger gating only Outscraper leaves Claude billing ~$45/mo uncapped when an abuser rotates distinct business URLs. Over budget: admin paths get an explicit "confirm paid overrun" override; the anonymous path gets the existing "at capacity" message. **Saves: converts every remaining soft ceiling into a hard one you wrote down.** Effort: ~1 day. One open question for you, Devon (Section 7): does your local Prospector use the *same* Google API key as the web app? If yes, they share one 1,000-event budget and the local engine must write to the same ledger or the guard undercounts.

4. **Sonnet for anonymous scans — with honest expectations.** Swap `claude-opus-4-8` (`anthropic.ts:89`) for Sonnet on anonymous calls; keep Opus for signed-in/paid scans where the full report is delivered. Two corrections to earlier estimates: Sonnet 5's tokenizer produces ~30% more tokens for the same text, so the real saving is **~25-45%, not 60-85%**; and the $2/$10 intro pricing **ends 2026-08-31** — budget on $3/$15. Check `max_tokens: 16000` (`anthropic.ts:90`) against the fatter tokenizer. **Ship only after the model passes the documented 7-case battery** (peppermoon, Reliance, McKenzie Lake, Two Small Men, Vanity House, Ricky Ratchets + one clean control) — the never-flag-honest-negatives guardrail is non-negotiable. Saves ~$3-6/mo now; stacks with the payload fix. Effort: ~1 hour + the eval.

5. **Retire Tower entirely.** After the Section-3 gating, port the deep audit off Tower: `outscraper.ts` already implements the async deep path (`opts.deep`), so the paid one-shot audit can run through the same TypeScript code — or you run `BUSINESS_URL=<URL> python3 pipeline/task.py` locally for a paying client (already documented in CLAUDE.md). Then cancel Tower and Nimble. **Saves: both legacy vendors' entire lines (base fees unverified — check first).** Effort: a session. This matches CLAUDE.md's stated target stack.

6. **Verify the Google SKU and ration discovery.** `google-places.ts:16-18` claims Pro tier / ~5,000 free events; the grounded price fact says rating+count fields land on **Enterprise: 1,000 free, then ~$35/1k**. Run one sweep, read the Cloud billing report, correct the comment. If Enterprise is right, headroom is 5× smaller than the code believes — fine at ~20 sweeps/month, ruinous (~$470/mo) if a daily multi-city cron ships unbudgeted. Weekly sweeps per market; the ledger (move 3) enforces it.

7. **Design monitoring right, before building it.** Two prerequisites: (a) spend one $0.05 test call to confirm Outscraper's `cutoff` (time filter, `outscraper.ts:271-273`) actually composes with `sort=lowest_rating + cutoffRating=2` — the entire "monthly diff bills ~0-5 reviews" economics rests on an API combination used nowhere in the codebase today; (b) codify the alert rule as an extension of the existing guardrail: **"never email a prospect and never alert a subscriber on scorer output alone"** — a $39/mo subscriber getting a false "you're under attack" alert is a churn event. Shape: incremental diff pull → free deterministic scorer → Claude gate (Batch API + Sonnet, 50% off, latency irrelevant for a monthly cron) → alert. Build it this way from day one; it's a choice, not a retrofit.

8. **Housekeeping:** add a TTL cleanup for `rate_events` (grows one row per anonymous scan, unbounded — migration 0006); confirm the ghost.reviews domain registration status (~$25+/yr for .reviews renewals if separate from ghostreviews.app).

---

## 5. Explicitly rejected (and why)

Future sessions: do **not** re-propose these. Each was killed on the merits.

1. **Haiku "clean pre-screen" in front of the scan** ("any negative signals? if none → canned clean report"). Makes a cheap model the *verifier of cleanliness* — the exact inversion CLAUDE.md forbids ("never make the pre-filter into the verifier"). The documented real-lead signature (textless 1★s from no-history accounts) is precisely what a cheap skim misses; it would serve canned "clean" reports to actual victims, the funnel's highest-value visitors. Also mechanically broken: `output_config.effort` errors on Haiku 4.5. **Sonnet with the full guardrail prompt, battery-validated, is the floor. Nothing cheaper.**

2. **7-day public-scan cache.** The most monetizable scan is a victim scanning *during* a fresh attack — often the week your cold email lands. A week-old cached report kills the lead at maximum intent. **24 hours, timestamp shown, force-refresh for signed-in users.**

3. **Cutting the "newest" batch from 36 to 20 reviews.** The negatives batch is `sort=lowest_rating` with no documented recency ordering *within* the 1-2★ band — on businesses with big chronic negative tails (law firms, movers: the documented false-positive verticals), a fresh attack's new 1★s aren't guaranteed to surface in the lowest-rated results. **The newest batch is the only guaranteed carrier of an in-progress attack** (signal #1, the Ricky Ratchets pattern). Saving was ~$0.03/scan; risk was missing live attacks. Skip it unless intra-band ordering is empirically verified first.

4. **Anonymous "teaser schema" that drops per-review reasoning.** Dropping *removal drafts* for anonymous calls: pure win (shipped, Section 3 item 5). Dropping *reasoning*: rejected — forcing a written justification per flag is part of what keeps the flag count honest, and the count is exactly what the anonymous owner sees.

5. **Routing paid deliverables (audit reports, filing drafts, subscriber alerts) through paste-in packets.** Pricing your time at zero. At 10 paying engagements/month, ~30-50 pastes × 2-5 min = 1-4 hours of founder time to save under $15 — on work where API cost is 0.3-1% of the price. **The split: packets for pre-revenue work (verification/outreach — already built); metered API for paid deliverables, where it's healthy COGS.**

6. **Any prompt-caching engineering.** The system prompt (~1.0-1.4k tokens) is below the minimum cacheable prefix on *every* plausible model (Opus family and Haiku 4.5: 4,096 tokens; Sonnet 4.6-era: 2,048). The earlier "it may start working for free on Sonnet" claim was checked and is false. Do not pad the prompt to force caching — costs more than it saves. Closed topic at current prompt sizes.

7. **"buildDeepAuditPacket from stored data" as originally scoped.** False premise: `prospect_scans` stores only flagged reviews' 200-char snippets, never the full pull. The salvageable version is the packet-at-scan-time design in Section 4 item 1.

8. **The "$0-8/mo end state" headline.** Double-booked the free tiers (Outscraper's 500 reviews and Google's 1,000 events each counted against two spenders). Honest end state: **~$5-15/mo variable** — still excellent; don't anchor on the fantasy number.

9. **Anything that shallows the pulls or relaxes the anchors.** Depth 75-100 negatives-only is already the documented minimum honest depth (~$2/lead all-in data cost, before your time and Stripe's $3.17). The v2 anchor scoring stays as-is. Not a cost lever; never was.

---

## 6. Residual cost + abuse ceiling after the overhaul

**What still costs money, and why that's fine:**

| Line | Amount | Why it's OK |
|---|---|---|
| Fresh anonymous scans | ~$0.10-0.15 each, ~$4-8/mo at realistic traffic | Lead-gen COGS; cached repeats are $0; ledger + vendor caps bound it |
| Admin deep dives | ~$0-3/mo (mostly inside the 500 free reviews) | The one paid data arrow; queue-gated, ledger-guarded |
| Paid audits + filing drafts | ~$0.50-1.00 per paying engagement + Stripe's ~$3.17 | Revenue-attached — scales only with income |
| Google discovery | $0 inside 1,000 free events (weekly sweeps, budgeted) | Ledger-guarded once move 3 ships |
| Fixed stack | Max sub ~$100-200 + Workspace ~$8-11 CAD + iPostal1 ~$10-25 + likely Vercel Pro $20 | The Max subscription IS the analysis engine; the rest is the cost of being a real business. Tower + Nimble go to $0 on cancellation. |

**Post-fix abuse ceiling, honestly stated:** an attacker rotating *distinct* business URLs defeats the cache and can burn ~50 scans/day × ~$0.18-0.28 ≈ **$9-14/day** — until the Outscraper ledger exhausts (day 1-2 of the month) and, because the ledger also covers the Anthropic provider (Section 4 move 3), scans then 503 honestly. The global daily bucket now counts signed-in users too, so account rotation buys nothing. The final backstop is the vendor dashboard caps: **~$25 Anthropic + ~$15 Outscraper = worst case ≈ $40/month, enforced at the vendor, by design.** Known accepted soft spots at this scale: a small check-then-insert race in `rate-limit.ts:94-127` (burst overshoot proportional to concurrency — pennies), and header-spoofing only matters off-Vercel.

Without the dashboard caps, every number above is soft. With them, the worst month an abuser can give you is $40.

---

## 7. Notes for the next model (Opus 4.8 handoff)

**State of the overhaul:** This document is the decided plan, post-red-team. Six surface audits were synthesized; duplicate savings were counted once; the killed proposals are in Section 5 and stay killed. As of 2026-07-01 **nothing in Sections 3-4 is built** — the codebase still has: authed rate-limit bypass, no cache reads anywhere, ledger unwired, Tower/Nimble live, Opus + pretty-printed JSON on the public scan, unauthenticated GET poll route, dashboard spend caps unset (HANDOFF.md:40 ⬜).

**Execution order (dependencies matter):** (1) dashboard caps — Devon, no code; (2) Tower gating incl. the GET route + cross-user save bug; (3) global-bucket-counts-everyone rate-limit fix; (4) payload slimming (lockstep with task.py); (5) anon draft-skip (keep reasoning); (6) Nimble + discovery-fallback deletion. THEN: the S2 schema decision **before** any cache or PIPEDA-minimization code (they currently specify opposite schemas — resolution: build packet at scan time in `prospect/route.ts:37-51`, persist packet text); then cache-first keyed on `deriveSearchQuery` (`outscraper.ts:325` — computed pre-spend; place_id backfill v2); then the ledger (`src/lib/cost-guard.ts` against `prospector_api_usage`, providers: outscraper/google_places/**anthropic**); then Sonnet swap (battery eval first; tokenizer +30%; intro pricing dies 2026-08-31; check max_tokens); then Tower retirement via `outscraper.ts` `opts.deep`.

**Key file map:** public scan `src/app/api/analyze/route.ts` (auth check :42-53, gating :104-111) → `src/lib/reviews.ts` (blend :76-84, Nimble fallback :41-45) → `src/lib/outscraper.ts` (negatives-only :257-264, unused `cutoff`/sinceMs :271-273, `deriveSearchQuery` :325) → `src/lib/anthropic.ts` (model :89, pretty JSON :84, no-op cache_control :100). Tower: `UrlAnalyzeForm.tsx` button, `analyze-tower/route.ts` (anon-allowed :49-57), `analyze-tower/[runSeq]/route.ts` (**zero auth**, cross-user save at end). Admin: `admin/prospect/route.ts` (unconditional pull :37, insert-only :77, snippet persistence :73), `admin/discover/route.ts` (silent paid fallback :75-76), `AdminDashboard.tsx` (wide→deep re-pull). $0 machinery: `verification-prompt.ts` (packet incl. email draft + FTC refusal), `prospect-scoring.ts` (v2 scorer). Guards: `rate-limit.ts` (fail-open :86, defaults :18-20, race :94-127), migration `0009_prospector.sql:180-186` (unwired ledger), `0006` (rate_events, no TTL), `0004` (services registry — add iPostal1/Workspace rows).

**Open questions for Devon:** (1) Does the local Prospector use the same Google API key/project as the web app? Determines whether it's one 1,000-event budget and whether the local engine must write to the Supabase ledger. (2) Tower and Nimble base fees — check both dashboards, then cancel per Section 4 move 5. (3) Vercel plan — Hobby is non-compliant for a Stripe-charging product; confirm and budget Pro. (4) Confirm the actual Google Places SKU after one sweep (code says Pro/5,000 free at `google-places.ts:16-18`; price facts say Enterprise/1,000 — 5× difference). (5) One $0.05 test call: does Outscraper `cutoff` compose with `sort=lowest_rating`? Monitoring economics depend on it.

**Operating rules (non-negotiable, from CLAUDE.md + this overhaul):** lockstep pairs — `src/lib/anthropic.ts` ↔ `pipeline/task.py` (prompt/schema/payload changes ship to both). Depth 50 is the floor for negatives visibility; 75-100 preferred; never shallow the negative side. DELTA/scorer output **ranks but never gates or verifies** — the pre-filter narrows, Claude verifies; never invert. Never email a prospect — and (new, codified) never alert a subscriber — on scorer output alone; Claude is the terminal gate for every human-facing claim. Never flag honest negatives (FTC §465.7 carve-out is the entire legal position); any model downgrade must pass the 7-case battery (peppermoon, Reliance, McKenzie Lake, Two Small Men, Vanity House, Ricky Ratchets, + clean control) before shipping. Never commit named-business prospect data; targets stay out of git. Packets serve pre-revenue work only; paid deliverables use the metered API as COGS. Prompt caching: closed topic below 4,096-token prompts. The 24h cache TTL and the keep-reasoning-in-teaser-schema decisions are red-team-final — don't relitigate.