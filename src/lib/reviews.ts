// Provider-agnostic entry point for pulling a business's reviews.
//
// Strategy: DataForSEO is the primary source (clean structured data, cheap,
// no brittle parsing). Nimble is kept as an automatic fallback — it covers
// three cases at once: DataForSEO not configured, DataForSEO erroring, and
// DataForSEO being too slow for the synchronous web path (its reviews endpoint
// is task-based). The swap is therefore zero-downtime: if anything about the
// new path fails, the old one quietly takes over.
//
// Both providers expose the same `scrapeBusinessReviews(input, maxReviews,
// sinceMs)` shape, so this orchestrator just tries them in order and tags
// which one produced the result.
import type { RatingSummary, Review } from "./analysis-schema";
import { scrapeBusinessReviews as scrapeViaDataForSeo } from "./dataforseo";
import { scrapeBusinessReviews as scrapeViaNimble } from "./nimble";

export type ReviewSource = "dataforseo" | "nimble";

export type BusinessReviews = {
  reviews: Review[];
  rating_summary: RatingSummary | null;
  source: ReviewSource;
};

export async function getBusinessReviews(
  input: string,
  maxReviews: number,
  sinceMs?: number,
): Promise<BusinessReviews | null> {
  // Primary: DataForSEO.
  const dfs = await scrapeViaDataForSeo(input, maxReviews, sinceMs);
  if (dfs && dfs.reviews.length > 0) {
    return { ...dfs, source: "dataforseo" };
  }

  // Fallback: Nimble (legacy).
  const nimble = await scrapeViaNimble(input, maxReviews, sinceMs);
  if (nimble && nimble.reviews.length > 0) {
    return { ...nimble, source: "nimble" };
  }

  return null;
}
