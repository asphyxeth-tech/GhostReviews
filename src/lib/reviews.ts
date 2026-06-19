// Provider-agnostic entry point for pulling a business's reviews.
//
// Strategy: Outscraper is the primary source (clean structured data, cheap
// pay-as-you-go, and it has a fast synchronous mode for the instant scan plus
// an async mode for deep audits). Nimble is the automatic fallback — it covers
// Outscraper being unconfigured, erroring, or too slow, so the swap is
// zero-downtime.
//
// `deep`: false (default) uses Outscraper's fast sync path — for the instant
// scan. true uses the async path (poll for minutes) — for the deep audit.
import type { RatingSummary, Review } from "./analysis-schema";
import {
  scrapeBusinessReviews as scrapeViaOutscraper,
  type ScrapeOptions,
  type BusinessMeta,
} from "./outscraper";
import { scrapeBusinessReviews as scrapeViaNimble } from "./nimble";

export type ReviewSource = "outscraper" | "nimble";

export type BusinessReviews = {
  reviews: Review[];
  rating_summary: RatingSummary | null;
  source: ReviewSource;
  // Business-level metadata (contact info, map, Google links). Only the
  // Outscraper path populates this; the Nimble fallback leaves it undefined.
  business?: BusinessMeta | null;
};

export async function getBusinessReviews(
  input: string,
  maxReviews: number,
  opts: ScrapeOptions = {},
): Promise<BusinessReviews | null> {
  // Primary: Outscraper.
  const os = await scrapeViaOutscraper(input, maxReviews, opts);
  if (os && os.reviews.length > 0) {
    return { ...os, source: "outscraper" };
  }

  // Fallback: Nimble (legacy synchronous scraper).
  const nimble = await scrapeViaNimble(input, maxReviews, opts.sinceMs);
  if (nimble && nimble.reviews.length > 0) {
    return { ...nimble, source: "nimble" };
  }

  return null;
}
