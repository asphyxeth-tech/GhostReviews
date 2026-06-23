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

    // Deep-dive pulls ONLY the 1–2★ negatives (the fraud evidence) — ~85–90%
    // cheaper than pulling all reviews, with no loss of detection signal. The
    // place-level rating distribution still arrives, so scoring's velocity
    // baseline is unaffected.
    const scrape = await getBusinessReviews(placeId, depth, {
      deep: true,
      negativesOnly: true,
    });
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

    const business = scrape.business ?? null;
    const resolvedName = businessName ?? business?.name ?? null;

    // Persist to the flywheel (service role; best-effort — don't fail the scan).
    const sb = createSupabaseAdmin();
    if (sb) {
      // Join each flagged review back to its direct Google link (by id) so the
      // per-business "file" can make every flagged review clickable.
      const linkById = new Map<string, string>();
      for (const rv of scrape.reviews) {
        if (rv.review_link) linkById.set(rv.id, rv.review_link);
      }
      const flagged = result.flagged_reviews.map((r) => ({
        review_id: r.id,
        author_id: r.author_id ?? "",
        author_name: r.reviewer_name,
        rating: r.rating,
        posted_at: r.posted_at,
        reviewer_total_reviews: r.reviewer_total_reviews,
        textless: !(r.text && r.text.trim()),
        text_snippet: (r.text || "").slice(0, 200),
        review_link: linkById.get(r.id) ?? "",
      }));
      try {
        await sb.from("prospect_scans").insert({
          place_id: placeId,
          business_name: resolvedName,
          query: placeId,
          total_reviews:
            totalReviewsIn ??
            scrape.rating_summary?.review_count ??
            business?.total_reviews ??
            null,
          scan_depth: depth,
          prefilter_score: result.score,
          anchor_fired: result.anchor_fired,
          rules_fired: result.rules_fired,
          counts: result.counts,
          flagged_reviews: flagged,
          // Business "file" metadata (Phase 2). All nullable.
          overall_rating:
            scrape.rating_summary?.overall_rating ??
            business?.overall_rating ??
            null,
          business_address: business?.address || null,
          business_phone: business?.phone || null,
          business_website: business?.website || null,
          business_maps_url: business?.maps_url || null,
          reviews_url: business?.reviews_url || null,
          latitude: business?.latitude ?? null,
          longitude: business?.longitude ?? null,
          scanned_by: admin.id,
        });
      } catch {
        // Persistence is best-effort.
      }
    }

    return NextResponse.json({
      place_id: placeId,
      business_name: resolvedName,
      reviews_source: scrape.source,
      reviews_pulled: scrape.reviews.length,
      score: result.score,
      anchor_fired: result.anchor_fired,
      is_candidate: result.score >= CANDIDATE_THRESHOLD,
      rules_fired: result.rules_fired,
      breakdown: result.breakdown,
      counts: result.counts,
      // Direct Google links so the dashboard can make the business name
      // clickable (reviews page preferred, Maps as fallback).
      reviews_url: business?.reviews_url || business?.maps_url || "",
      maps_url: business?.maps_url || "",
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
