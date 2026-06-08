// Single source of truth for the bundled sample dataset. Both the
// Next.js app and the Python pipeline read from the SAME JSON files
// (pipeline/mock_reviews.json and pipeline/mock_report.json) so the
// canned demo flow can never drift between the two implementations.
//
// Next.js + TypeScript supports JSON imports out of the box (the
// tsconfig.json `resolveJsonModule` flag is enabled) and the bundler
// happily reaches outside `src/` for these — they're build-time
// resources, not runtime fetches.
import mockReviewsJson from "../../pipeline/mock_reviews.json";
import mockReportJson from "../../pipeline/mock_report.json";
import type { AnalysisReport, Review } from "./analysis-schema";

export const MOCK_REVIEWS: Review[] = mockReviewsJson as Review[];
export const MOCK_REPORT: AnalysisReport = mockReportJson as AnalysisReport;
