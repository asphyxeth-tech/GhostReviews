// v2 prospect pre-filter scoring — the TypeScript port of `score_business` in
// pipeline/prospect.py. Powers the admin dashboard's per-business scoring.
//
// ⚠️ LOCKSTEP: this is a 1:1 port of the Python scorer. Any change to the
// methodology (constants, anchors, corroboration, the anchor-gate) MUST be made
// in BOTH places — same as the anthropic.ts ↔ task.py pair. See METHODOLOGY.md.
//
// Pure + deterministic (no I/O), so it's fully unit-testable.

// ---- constants (mirror prospect.py) ----
export const SCORE_BURST = 40;
export const SCORE_SPIKE = 40;
export const SCORE_THROWAWAY = 20;
export const SCORE_TEXTLESS = 15;
export const SCORE_TIGHT_CLUSTER = 15;

export const CANDIDATE_THRESHOLD = 50;

const BURST_WINDOW_DAYS = 14;
const SPIKE_WINDOW_DAYS = 7;
const BURST_VELOCITY_MULTIPLIER = 3.0;
const BURST_MIN_COUNT = 3;
const SPIKE_MIN_COUNT = 3;
const SPIKE_MAX_ONESTAR_SHARE = 0.2;
const THROWAWAY_MIN_COUNT = 2;
const THROWAWAY_MAX_REVIEWS = 2;
const TEXTLESS_MAX_WORDS = 3;
const TIGHT_CLUSTER_MIN_COUNT = 2;
const TIGHT_CLUSTER_WINDOW_MINUTES = 60;

// ---- types ----
export type ScoredReview = {
  id: string;
  author_id?: string;
  reviewer_name: string;
  reviewer_total_reviews: number;
  rating: number;
  posted_at: string; // ISO 8601
  text: string;
};

export type RatingSummary = {
  overall_rating: number;
  review_count: number;
  ratings_count: Record<string, number>;
};

export type ScoreResult = {
  score: number;
  rules_fired: string[];
  breakdown: Record<string, number>;
  counts: {
    total_reviews_pulled: number;
    burst_window_negatives: number;
    spike_window_ones: number;
    throwaway_negatives: number;
    textless_onestar_throwaway: number;
    tightest_cluster_gap_minutes: number | null;
  };
  flagged_reviews: ScoredReview[];
  anchor_fired: boolean;
};

// ---- helpers (mirror prospect.py) ----
function parsePostedAt(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t / 1000; // seconds
}

function wordCount(text: string): number {
  return text && text.trim() ? text.trim().split(/\s+/).length : 0;
}

function secondsBetween(a: string, b: string): number {
  return Math.abs(parsePostedAt(a) - parsePostedAt(b));
}

// Robust to negatives-only input: the baseline rate is the business's TRUE total
// negatives (from the place-level rating distribution, which Outscraper returns
// regardless of the review filter) divided by the observed negative span — so it
// stays accurate whether `reviews` is a newest-sample or a negatives-only pull.
function expectedNegativesPerWindow(
  ratingSummary: RatingSummary | null,
  reviews: ScoredReview[],
  windowDays: number,
): number {
  if (reviews.length === 0) return 0;

  let totalReviews = 0;
  if (ratingSummary) {
    const n = Number(ratingSummary.review_count);
    if (Number.isFinite(n)) totalReviews = Math.trunc(n);
  }

  let negShare = 0;
  if (ratingSummary?.ratings_count) {
    const rc = ratingSummary.ratings_count;
    const ones = Number(rc["1"] ?? 0);
    const twos = Number(rc["2"] ?? 0);
    const total = Math.max(1, totalReviews);
    if (Number.isFinite(ones) && Number.isFinite(twos)) {
      negShare = (ones + twos) / total;
    }
  }

  // Can't estimate — fall back to 0 ("unknown, don't suppress the anchor").
  if (totalReviews === 0 || negShare === 0) return 0;

  const tss = reviews.map((r) => parsePostedAt(r.posted_at));
  const oldest = Math.min(...tss);
  const newest = Math.max(...tss);
  let spanDays = (newest - oldest) / 86400;
  if (spanDays < 7) spanDays = 90; // tiny span -> assume ~3 months of activity

  const expectedTotalNeg = totalReviews * negShare;
  return (expectedTotalNeg / Math.max(spanDays, 1)) * windowDays;
}

function findRollingWindowPeak(
  reviews: ScoredReview[],
  windowDays: number,
  minRating: number,
  maxRating: number,
): { count: number; window: ScoredReview[] } {
  const targeted = reviews
    .filter((r) => r.rating >= minRating && r.rating <= maxRating)
    .sort((a, b) => parsePostedAt(a.posted_at) - parsePostedAt(b.posted_at));
  if (targeted.length === 0) return { count: 0, window: [] };

  const windowSeconds = windowDays * 86400;
  let bestCount = 0;
  let bestWindow: ScoredReview[] = [];
  let left = 0;

  for (let right = 0; right < targeted.length; right++) {
    const tRight = parsePostedAt(targeted[right].posted_at);
    while (tRight - parsePostedAt(targeted[left].posted_at) > windowSeconds) {
      left++;
    }
    const size = right - left + 1;
    if (size > bestCount) {
      bestCount = size;
      bestWindow = targeted.slice(left, right + 1);
    }
  }
  return { count: bestCount, window: bestWindow };
}

/**
 * Compute the v2 heuristic score for one business. No I/O, no Claude — the
 * cheap pre-filter layer only. Anchors (BURST/SPIKE) are required; without one,
 * the score is forced to 0 (corroboration can never fire alone).
 */
export function scoreBusiness(data: {
  rating_summary: RatingSummary | null;
  reviews: ScoredReview[];
}): ScoreResult {
  const ratingSummary = data.rating_summary;
  const reviews = data.reviews || [];

  const result: ScoreResult = {
    score: 0,
    rules_fired: [],
    breakdown: {},
    counts: {
      total_reviews_pulled: reviews.length,
      burst_window_negatives: 0,
      spike_window_ones: 0,
      throwaway_negatives: 0,
      textless_onestar_throwaway: 0,
      tightest_cluster_gap_minutes: null,
    },
    flagged_reviews: [],
    anchor_fired: false,
  };

  if (reviews.length === 0) return result;

  const flaggedIds = new Set<string>();
  const addFlagged = (rs: ScoredReview[]) => {
    for (const r of rs) {
      if (!flaggedIds.has(r.id)) {
        flaggedIds.add(r.id);
        result.flagged_reviews.push(r);
      }
    }
  };

  // ANCHOR 1: BURST — >=3 negatives (<=2*) in any 14-day window, velocity-normalized.
  const burst = findRollingWindowPeak(reviews, BURST_WINDOW_DAYS, 1, 2);
  result.counts.burst_window_negatives = burst.count;
  if (burst.count >= BURST_MIN_COUNT) {
    const expected = expectedNegativesPerWindow(ratingSummary, reviews, BURST_WINDOW_DAYS);
    // expected === 0 means "can't estimate" -> allow the anchor (conservative).
    if (expected === 0 || burst.count >= BURST_VELOCITY_MULTIPLIER * expected) {
      result.anchor_fired = true;
      result.rules_fired.push("BURST");
      result.breakdown.BURST = SCORE_BURST;
      result.score += SCORE_BURST;
      addFlagged(burst.window);
    }
  }

  // ANCHOR 2: SPIKE — >=3 one-star in any 7-day window when all-time 1* share < 20%.
  const spike = findRollingWindowPeak(reviews, SPIKE_WINDOW_DAYS, 1, 1);
  result.counts.spike_window_ones = spike.count;
  let onestarShare = 0;
  if (ratingSummary?.ratings_count) {
    const total = Math.max(1, Number(ratingSummary.review_count) || 1);
    const ones = Number(ratingSummary.ratings_count["1"] ?? 0);
    if (Number.isFinite(ones)) onestarShare = ones / total;
  }
  if (spike.count >= SPIKE_MIN_COUNT && onestarShare < SPIKE_MAX_ONESTAR_SHARE) {
    result.anchor_fired = true;
    result.rules_fired.push("SPIKE");
    result.breakdown.SPIKE = SCORE_SPIKE;
    result.score += SCORE_SPIKE;
    addFlagged(spike.window);
  }

  // Anchor gate: no anchor -> score 0. Corroboration CANNOT substitute (v2).
  if (!result.anchor_fired) {
    result.score = 0;
    return result;
  }

  // CORROBORATION 1: THROWAWAY — >=2 recent negatives from <=2-lifetime-review accounts.
  const recentNegatives = reviews.filter((r) => r.rating <= 2);
  const throwawayNegs = recentNegatives.filter(
    (r) => (r.reviewer_total_reviews ?? 999) <= THROWAWAY_MAX_REVIEWS,
  );
  result.counts.throwaway_negatives = throwawayNegs.length;
  if (throwawayNegs.length >= THROWAWAY_MIN_COUNT) {
    result.rules_fired.push("THROWAWAY");
    result.breakdown.THROWAWAY = SCORE_THROWAWAY;
    result.score += SCORE_THROWAWAY;
    addFlagged(throwawayNegs);
  }

  // CORROBORATION 2: TEXTLESS — >=1 near-textless 1* from a low-history account.
  const onestar = reviews.filter((r) => r.rating === 1);
  const textlessThrowaway = onestar.filter(
    (r) =>
      wordCount(r.text || "") <= TEXTLESS_MAX_WORDS &&
      (r.reviewer_total_reviews ?? 999) <= THROWAWAY_MAX_REVIEWS,
  );
  result.counts.textless_onestar_throwaway = textlessThrowaway.length;
  if (textlessThrowaway.length > 0) {
    result.rules_fired.push("TEXTLESS");
    result.breakdown.TEXTLESS = SCORE_TEXTLESS;
    result.score += SCORE_TEXTLESS;
    addFlagged(textlessThrowaway);
  }

  // CORROBORATION 3: TIGHT_CLUSTER — >=2 negatives within 60 minutes.
  const allNegSorted = [...recentNegatives].sort(
    (a, b) => parsePostedAt(a.posted_at) - parsePostedAt(b.posted_at),
  );
  let tightestGap: number | null = null;
  let tightPair: ScoredReview[] = [];
  for (let i = 0; i < allNegSorted.length - 1; i++) {
    const gapMin =
      secondsBetween(allNegSorted[i].posted_at, allNegSorted[i + 1].posted_at) / 60;
    if (tightestGap === null || gapMin < tightestGap) {
      tightestGap = gapMin;
      tightPair = [allNegSorted[i], allNegSorted[i + 1]];
    }
  }
  if (tightestGap !== null) {
    result.counts.tightest_cluster_gap_minutes = Math.round(tightestGap * 10) / 10;
  }
  if (tightestGap !== null && tightestGap <= TIGHT_CLUSTER_WINDOW_MINUTES) {
    const pairTs = tightPair.map((r) => parsePostedAt(r.posted_at));
    const windowStart = Math.min(...pairTs);
    const windowEnd = Math.max(...pairTs);
    const cluster = allNegSorted.filter((r) => {
      const t = parsePostedAt(r.posted_at);
      return t >= windowStart - 0.1 && t <= windowEnd + 0.1;
    });
    if (cluster.length >= TIGHT_CLUSTER_MIN_COUNT) {
      result.rules_fired.push("TIGHT_CLUSTER");
      result.breakdown.TIGHT_CLUSTER = SCORE_TIGHT_CLUSTER;
      result.score += SCORE_TIGHT_CLUSTER;
      addFlagged(cluster);
    }
  }

  return result;
}
