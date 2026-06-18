// POST /api/admin/prospect — admin-only. Pull one business's reviews
// (Outscraper, deep), run the v2 pre-filter scorer, persist to the
// prospect_scans flywheel, and return the score. The dashboard calls this once
// per business so each request fits Vercel's function limit.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser, createSupabaseAdmin } from "@/lib/admin";
import { getBusinessReviews } from "@/lib/reviews";
import { scoreBusiness, CANDIDATE_THRESHOLD } from "@/lib/prospect-scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const placeId =
      (typeof body.place_id === "string" && body.place_id) ||
      (typeof body.query === "string" && body.query) ||
      "";
    if (!placeId) {
      return NextResponse.json({ error: "place_id is required" }, { status: 400 });
    }
    const depth = Number(body.depth) || 75;
    const businessName =
      typeof body.business_name === "string" ? body.business_name : null;
    const totalReviewsIn =
      body.total_reviews != null ? Number(body.total_reviews) : null;

    const scrape = await getBusinessReviews(placeId, depth, { deep: true });
    if (!scrape || scrape.reviews.length === 0) {
      return NextResponse.json(
        { error: "no reviews returned", place_id: placeId },
        { status: 502 },
      );
    }

    const result = scoreBusiness({
      rating_summary: scrape.rating_summary,
      reviews: scrape.reviews,
    });

    // Persist to the flywheel (service role; best-effort — don't fail the scan).
    const sb = createSupabaseAdmin();
    if (sb) {
      const flagged = result.flagged_reviews.map((r) => ({
        review_id: r.id,
        author_id: r.author_id ?? "",
        author_name: r.reviewer_name,
        rating: r.rating,
        posted_at: r.posted_at,
        reviewer_total_reviews: r.reviewer_total_reviews,
        textless: !(r.text && r.text.trim()),
        text_snippet: (r.text || "").slice(0, 200),
      }));
      try {
        await sb.from("prospect_scans").insert({
          place_id: placeId,
          business_name: businessName,
          query: placeId,
          total_reviews:
            totalReviewsIn ?? scrape.rating_summary?.review_count ?? null,
          scan_depth: depth,
          prefilter_score: result.score,
          anchor_fired: result.anchor_fired,
          rules_fired: result.rules_fired,
          counts: result.counts,
          flagged_reviews: flagged,
          scanned_by: admin.id,
        });
      } catch {
        // Persistence is best-effort.
      }
    }

    return NextResponse.json({
      place_id: placeId,
      business_name: businessName,
      reviews_source: scrape.source,
      reviews_pulled: scrape.reviews.length,
      score: result.score,
      anchor_fired: result.anchor_fired,
      is_candidate: result.score >= CANDIDATE_THRESHOLD,
      rules_fired: result.rules_fired,
      breakdown: result.breakdown,
      counts: result.counts,
      flagged_reviews: result.flagged_reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        posted_at: r.posted_at,
        reviewer_total_reviews: r.reviewer_total_reviews,
        text: (r.text || "").slice(0, 160),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "scoring failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
