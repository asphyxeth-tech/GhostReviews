import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeReviewsWithClaude } from "@/lib/anthropic";
import { getBlendedReviews } from "@/lib/reviews";
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

// The instant web scan is a free "preview". It pulls a NEGATIVES-AWARE blend
// (see getBlendedReviews): a newest chunk for freshness + a lowest-rating chunk
// so the 1–2★ fraud evidence is never drowned out by recent 4–5★ reviews. With
// maxDuration=300 (Fluid Compute) the old 40-cap latency reason is stale, so we
// pull a bit deeper to surface the depth-~50 textless-negative signals the
// product depends on (CLAUDE.md), while keeping per-scan cost reasonable.
// The Tower pipeline does the deep "audit hundreds → all" scan with no time
// limit — that's the paid tier (and the "Deep scan via Tower" button).
const WEB_MAX_REVIEWS = 60;
const WEB_ANALYSIS_EFFORT = "medium" as const;

const RequestSchema = z.object({
  url: z.string().url(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = RequestSchema.parse(body);

    // Signed-in users get the full report; anonymous visitors get a gated
    // teaser. EVERYONE is rate-limited: every scan draws from the same
    // "analyze" bucket, so the global daily ceiling counts signed-in and
    // anonymous scans alike — rotating free magic-link accounts no longer
    // bypasses the cost cap (docs/COST_OVERHAUL.md §3.3). Fairness caps
    // differ by caller type:
    //   - anonymous: per-IP throttle (defaults in rate-limit.ts: 5/hour)
    //   - signed-in: per-user throttle, 15 scans per rolling 24h, keyed on
    //     the user id so it survives IP changes
    let isAuthed = false;
    let userId = "";
    const supabase = await createSupabaseServer();
    if (supabase) {
      const { data } = await supabase.auth.getUser();
      isAuthed = Boolean(data.user);
      userId = data.user?.id ?? "";
    }
    const limit = isAuthed
      ? await checkRateLimit("analyze", `user:${userId}`, {
          perIp: 15,
          windowMin: 1440,
        })
      : await checkRateLimit("analyze", clientIp(req));
    if (!limit.ok) {
      return NextResponse.json({ error: limit.reason }, { status: 429 });
    }

    // SAFETY (no fabricated attacks): if Claude isn't configured we must NEVER
    // analyze the bundled MOCK sample and present a canned ~72/100 "coordinated
    // attack" as if it were the visitor's real business. That report names fake
    // people and would terrify a real owner scanning their own profile. Return
    // a clean "temporarily unavailable" instead. (A local-dev demo, if ever
    // wanted, belongs behind an explicit, clearly-labeled flag — not the
    // public default — so it can't leak to a real prospect.)
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    if (!hasKey) {
      console.error("[/api/analyze] ANTHROPIC_API_KEY unset — refusing to serve a mock attack.");
      return NextResponse.json(
        {
          error:
            "Scanning is temporarily unavailable. Please try again in a little while.",
        },
        { status: 503 },
      );
    }
    const mode: "stub" | "live" = "live";

    // Negatives-aware live pull (newest + lowest-rating, deduped) so the fraud
    // signal isn't drowned by recent 4–5★ reviews. No mock fallback here.
    const scrape = await getBlendedReviews(url, WEB_MAX_REVIEWS);
    const haveLive = Boolean(scrape && scrape.reviews.length > 0);

    // SAFETY (no fabricated attacks): if the live scrape came back empty
    // (Outscraper failed, or the URL didn't resolve to a real Google place),
    // return an honest error. We do NOT analyze mock data and hand a public
    // visitor a fake attack on their own business.
    if (!haveLive) {
      return NextResponse.json(
        {
          error:
            "We couldn't pull reviews for that Google profile — double-check the Maps URL (or business name + city) and try again.",
        },
        { status: 502 },
      );
    }

    const reviews = scrape!.reviews;
    // "nimble" only survives in the persisted-scan type for old saved rows and
    // the legacy Tower pipeline; the web path is Outscraper-only now.
    const reviewsSource: "outscraper" = scrape!.source;

    // isAuthed also picks the Claude output shape: anonymous scans skip the
    // removal-draft generation entirely (they were being paid for at Opus
    // output rates and then stripped below) while the per-review reasoning
    // requirement is unchanged — see analyzeReviewsWithClaude.
    const report = await analyzeReviewsWithClaude(
      url,
      reviews,
      scrape!.rating_summary,
      WEB_ANALYSIS_EFFORT,
      isAuthed,
    );

    // Gate the deliverable for anonymous users: strip the per-review detail
    // and expose only the count. (Anonymous runs no longer generate removal
    // drafts at all — see analyzeReviewsWithClaude — so nothing expensive is
    // thrown away here.) Signed-in users get the full report. The gating is
    // server-side so per-review detail never reaches an anonymous caller.
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
      // preview framing); null if the scrape lacked it.
      reviews_total: scrape!.rating_summary?.review_count ?? null,
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
