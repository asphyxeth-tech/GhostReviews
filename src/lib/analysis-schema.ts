import { z } from "zod";

export const ReviewSchema = z.object({
  id: z.string(),
  reviewer_name: z.string(),
  reviewer_total_reviews: z.number().int(),
  rating: z.number().int().min(1).max(5),
  posted_at: z.string(),
  text: z.string(),
});
export type Review = z.infer<typeof ReviewSchema>;

// Business-wide star-rating distribution, scraped from the Google Maps
// place result. Not part of the API response payload — it's passed to
// Claude as a real baseline for judging rating-distribution anomalies.
export const RatingSummarySchema = z.object({
  overall_rating: z.number(),
  review_count: z.number().int(),
  ratings_count: z.record(z.string(), z.number().int()),
});
export type RatingSummary = z.infer<typeof RatingSummarySchema>;

export const FlaggedReviewSchema = z.object({
  review_id: z.string(),
  reviewer_name: z.string(),
  rating: z.number().int().min(1).max(5),
  posted_at: z.string(),
  risk_level: z.enum(["low", "medium", "high"]),
  signals: z.array(z.string()),
  reasoning: z.string(),
  removal_request_draft: z.string(),
});
export type FlaggedReview = z.infer<typeof FlaggedReviewSchema>;

export const AnalysisReportSchema = z.object({
  overall_risk_score: z.number().int().min(0).max(100),
  risk_level: z.enum(["low", "medium", "high", "critical"]),
  summary: z.string(),
  flagged_reviews: z.array(FlaggedReviewSchema),
  total_reviews_analyzed: z.number().int(),
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

export const AnalyzeResponseSchema = z.object({
  mode: z.enum(["stub", "live"]),
  business_url: z.string(),
  generated_at: z.string(),
  // Which source produced the reviews: "dataforseo" (primary) or "nimble"
  // (fallback) for live scrapes, "mock" when we fell back to the bundled
  // sample dataset (no scraper configured or the upstream failed).
  // Zod .parse() strips unknown keys, so this field must live on the
  // schema or it disappears from the response payload.
  reviews_source: z.enum(["dataforseo", "nimble", "mock"]),
  // The business's all-time review count from Google (e.g. 10342) when a
  // live scrape captured it — powers the "previewed N of M total" upsell.
  // Optional so payloads without it (e.g. older Tower runs) still validate.
  reviews_total: z.number().int().nullable().optional(),
  report: AnalysisReportSchema,
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
