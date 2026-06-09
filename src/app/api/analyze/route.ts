import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeReviewsWithClaude } from "@/lib/anthropic";
import { scrapeBusinessReviews } from "@/lib/nimble";
import { MOCK_REVIEWS, MOCK_REPORT } from "@/lib/mock-data";
import { AnalyzeResponseSchema, type AnalyzeResponse } from "@/lib/analysis-schema";

// Vercel Hobby tier caps Node functions at 10 seconds by default.
// Nimble (place lookup + a few paginated review pages) + Claude in series
// can exceed that, so bump the cap. (Vercel max for Hobby is 60s.)
export const maxDuration = 60;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The instant web scan is a free "preview": the most-recent reviews,
// analyzed at medium effort. Vercel's Hobby tier hard-caps functions at
// 60s. Live timings observed:
//   - 100 reviews -> 62s -> HTTP 504 (failed)
//   - 50 reviews  -> 60.5s -> 200 by 0.5s (unsafe margin)
//   - 40 reviews  -> ~33s -> 200 (safe)
// Cap at 40 to leave a safe margin for normal Claude latency variance.
// The Tower pipeline does the deep "audit hundreds → all" scan with no
// time limit — that's the paid tier (and the "Deep scan via Tower" button).
const WEB_MAX_REVIEWS = 40;
const WEB_ANALYSIS_EFFORT = "medium" as const;

const RequestSchema = z.object({
  url: z.string().url(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = RequestSchema.parse(body);

    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const mode: "stub" | "live" = hasKey ? "live" : "stub";

    // In stub mode the canned MOCK_REPORT flags specific review IDs from
    // MOCK_REVIEWS — so we must NOT swap in Nimble-scraped reviews there,
    // or the UI would label a Nimble batch with a mismatched report. Only
    // scrape when we're actually going to analyze the batch with Claude.
    const scrape = hasKey ? await scrapeBusinessReviews(url, WEB_MAX_REVIEWS) : null;
    const haveLive = Boolean(scrape && scrape.reviews.length > 0);
    const reviews = haveLive ? scrape!.reviews : MOCK_REVIEWS;
    const reviewsSource: "nimble" | "mock" = haveLive ? "nimble" : "mock";

    const report = hasKey
      ? await analyzeReviewsWithClaude(
          url,
          reviews,
          haveLive ? scrape!.rating_summary : null,
          WEB_ANALYSIS_EFFORT,
        )
      : MOCK_REPORT;

    const response: AnalyzeResponse = {
      mode,
      business_url: url,
      generated_at: new Date().toISOString(),
      reviews_source: reviewsSource,
      // The business's all-time review count (for the "N of M total"
      // preview framing); null in mock mode or if the scrape lacked it.
      reviews_total: haveLive ? (scrape!.rating_summary?.review_count ?? null) : null,
      report,
    };

    return NextResponse.json(AnalyzeResponseSchema.parse(response));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Please paste a valid URL." },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Analysis failed: ${message}` },
      { status: 500 },
    );
  }
}
