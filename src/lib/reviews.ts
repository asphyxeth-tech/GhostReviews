// Entry point for pulling a business's reviews.
//
// Outscraper is the ONLY review source. The legacy Nimble fallback was deleted
// (docs/COST_OVERHAUL.md §3 item 6): it fired silently on every Outscraper
// timeout, spending a second paid vendor's credits with no budget and no log.
// When Outscraper comes up empty we now return null and the callers respond
// honestly — the public scan route returns a clean 502 ("try again"), which is
// the right posture at $0 revenue.
//
// `deep`: false (default) uses Outscraper's fast sync path — for the instant
// scan. true uses the async path (poll for minutes) — for the deep audit.
import type { RatingSummary, Review } from "./analysis-schema";
import {
  scrapeBusinessReviews as scrapeViaOutscraper,
  type ScrapeOptions,
  type BusinessMeta,
} from "./outscraper";

export type ReviewSource = "outscraper";

export type BusinessReviews = {
  reviews: Review[];
  rating_summary: RatingSummary | null;
  source: ReviewSource;
  // Business-level metadata (contact info, map, Google links). Best-effort —
  // Outscraper doesn't always populate every field.
  business?: BusinessMeta | null;
};

export async function getBusinessReviews(
  input: string,
  maxReviews: number,
  opts: ScrapeOptions = {},
): Promise<BusinessReviews | null> {
  const os = await scrapeViaOutscraper(input, maxReviews, opts);
  if (os && os.reviews.length > 0) {
    return { ...os, source: "outscraper" };
  }

  // No fallback scraper — an empty/failed pull surfaces as null so the caller
  // can return an honest "couldn't pull reviews" error instead of silently
  // spending money elsewhere.
  return null;
}

/**
 * Negatives-aware pull for the free public scan.
 *
 * Why: a plain newest-first pull of ~40 reviews drowns the signal the whole
 * product depends on. The strongest tells (textless 1★ reviews from no-history
 * accounts, tight 1★ clusters) live in the NEGATIVE tail, and on a healthy
 * business the newest 40 reviews can be almost entirely 4–5★ — so Claude never
 * even sees the evidence. (Per CLAUDE.md: these patterns are visible at depth
 * ~50, invisible at depth ~10.) `maxDuration=300` is set on the route now, so
 * the old 40-cap latency reason is stale.
 *
 * Strategy: pull TWO Outscraper batches and merge them, deduped by review id:
 *   1. a NEWEST batch — catches a fresh, in-progress attack and gives recent
 *      organic context, and
 *   2. a LOWEST-RATING batch (negativesOnly) — guarantees the 1–2★ fraud
 *      evidence is in the set even when it's old or buried.
 * We keep the per-batch size modest so total reviews billed/analyzed stays
 * reasonable. If the blend comes up empty, one plain `getBusinessReviews`
 * retry (same vendor, Outscraper) runs before we give up and return null.
 */
export async function getBlendedReviews(
  input: string,
  maxReviews: number,
): Promise<BusinessReviews | null> {
  // Split the budget: ~60% newest for freshness/context, ~40% negatives so the
  // fraud tail is always represented. (At maxReviews=60 that's 36 + 24.)
  const newestN = Math.max(1, Math.round(maxReviews * 0.6));
  const negativesN = Math.max(1, maxReviews - newestN);

  // Pull both batches in parallel. negativesOnly biases the second batch to
  // 1–2★ (sort=lowest_rating, cutoffRating=2) — see outscraper.ts.
  const [newest, negatives] = await Promise.all([
    scrapeViaOutscraper(input, newestN, {}),
    scrapeViaOutscraper(input, negativesN, { negativesOnly: true }),
  ]);

  // If Outscraper produced nothing on either batch, retry once via the plain
  // path (still Outscraper — no other vendor). If that also fails, the caller
  // returns an honest error.
  if (
    (!newest || newest.reviews.length === 0) &&
    (!negatives || negatives.reviews.length === 0)
  ) {
    return getBusinessReviews(input, maxReviews);
  }

  // Prefer the batch that actually returned a rating_summary/business meta.
  const base = (newest && newest.reviews.length > 0 ? newest : negatives)!;

  // Merge, deduping by review id (the same review can appear in both batches).
  const byId = new Map<string, Review>();
  for (const r of newest?.reviews ?? []) byId.set(r.id, r);
  for (const r of negatives?.reviews ?? []) byId.set(r.id, r);

  const merged = Array.from(byId.values()).sort(
    (a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at),
  );
  if (merged.length === 0) return getBusinessReviews(input, maxReviews);

  return {
    reviews: merged,
    rating_summary: base.rating_summary,
    business: base.business,
    source: "outscraper",
  };
}
