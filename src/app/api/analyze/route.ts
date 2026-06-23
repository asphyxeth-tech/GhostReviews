import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeReviewsWithClaude } from "@/lib/anthropic";
import { getBusinessReviews } from "@/lib/reviews";
import { MOCK_REVIEWS, MOCK_REPORT } from "@/lib/mock-data";
import { AnalyzeResponseSchema, type AnalyzeResponse } from "@/lib/analysis-schema";
import { saveScanIfAuthenticated } from "@/lib/scan-store";
import { createSupabaseServer } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// With Fluid Compute (default on newer Vercel projects), Hobby allows up to
// 300s maxDuration — the old 60s value was a self-imposed ceiling that caused
// intermittent 504s whenever the upstream scrape ran slow. The PR preview
// deploy validates the plan actually accepts this; if the build rejects it,
// drop back to 60.
export const maxDuration = 300;

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

    // Signed-in users get the full report and skip the rate limit; anonymous
    // visitors get a gated teaser and are throttled (abuse/cost protection).
    let isAuthed = false;
    const supabase = await createSupabaseServer();
    if (supabase) {
      const { data } = await supabase.auth.getUser();
      isAuthed = Boolean(data.user);
    }
    if (!isAuthed) {
      const limit = await checkRateLimit("analyze", clientIp(req));
      if (!limit.ok) {
        return NextResponse.json({ error: limit.reason }, { status: 429 });
      }
    }

    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const mode: "stub" | "live" = hasKey ? "live" : "stub";

    // In stub mode the canned MOCK_REPORT flags specific review IDs from
    // MOCK_REVIEWS — so we must NOT swap in scraped reviews there, or the UI
    // would label a live batch with a mismatched report. Only scrape when
    // we're actually going to analyze the batch with Claude.
    const scrape = hasKey ? await getBusinessReviews(url, WEB_MAX_REVIEWS) : null;
    const haveLive = Boolean(scrape && scrape.reviews.length > 0);
    const reviews = haveLive ? scrape!.reviews : MOCK_REVIEWS;
    const reviewsSource: "outscraper" | "nimble" | "mock" = haveLive
      ? scrape!.source
      : "mock";

    const report = hasKey
      ? await analyzeReviewsWithClaude(
          url,
          reviews,
          haveLive ? scrape!.rating_summary : null,
          WEB_ANALYSIS_EFFORT,
        )
      : MOCK_REPORT;

    // Gate the deliverable for anonymous users: strip the per-review detail
    // (reasoning + drafted removal requests) and expose only the count. Signed-
    // in users get the full report. The gating is server-side so the API never
    // emits the drafts to an anonymous caller.
    const flaggedCount = report.flagged_reviews.length;
    const visibleReport = isAuthed
      ? report
      : { ...report, flagged_reviews: [] };

    const response: AnalyzeResponse = {
      mode,
      business_url: url,
      generated_at: new Date().toISOString(),
      reviews_source: reviewsSource,
      // The business's all-time review count (for the "N of M total"
      // preview framing); null in mock mode or if the scrape lacked it.
      reviews_total: haveLive ? (scrape!.rating_summary?.review_count ?? null) : null,
      gated: !isAuthed,
      flagged_count: flaggedCount,
      report: visibleReport,
    };

    const validated = AnalyzeResponseSchema.parse(response);

    // Signed-in users get the scan saved to their dashboard history.
    // Anonymous scans (and unconfigured environments) skip this silently.
    await saveScanIfAuthenticated(validated);

    return NextResponse.json(validated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Please paste a valid URL." },
        { status: 400 },
      );
    }
    // Don't leak upstream/internal error detail to the browser — log it server-
    // side and return a generic message.
    console.error("[/api/analyze] failed:", err);
    return NextResponse.json(
      { error: "Analysis failed — please try again." },
      { status: 500 },
    );
  }
}
