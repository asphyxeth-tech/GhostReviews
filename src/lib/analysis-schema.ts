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
  report: AnalysisReportSchema,
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
