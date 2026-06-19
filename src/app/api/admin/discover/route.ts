// POST /api/admin/discover — admin-only. Search Google Maps (Outscraper) for
// businesses matching a "category, city" query; returns the list to score.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { discoverBusinesses } from "@/lib/outscraper-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }
    const limit = Number(body.limit) || 50;
    const region = typeof body.region === "string" && body.region ? body.region : "CA";

    // Discovery filters (all optional; 0 / empty = off). These narrow the
    // universe BEFORE we spend Outscraper review-pull credits.
    const minReviews = Number(body.minReviews) || 0;
    const maxReviews = Number(body.maxReviews) || 0; // value ceiling
    const maxRating = Number(body.maxRating) || 0; // closeability ceiling
    const minOneStarPct = Number(body.minOneStarPct) || 0; // 1-star share floor
    const excludeRaw: string =
      typeof body.excludeTypes === "string" ? body.excludeTypes : "";
    const excludeTypes = excludeRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const oneStarShare = (b: { reviews_per_score: Record<string, number> | null; total_reviews: number }) => {
      if (!b.reviews_per_score || b.total_reviews <= 0) return 0;
      const ones = Number(b.reviews_per_score["1"] ?? 0);
      return Number.isFinite(ones) ? ones / b.total_reviews : 0;
    };

    const businesses = await discoverBusinesses(query, { limit, region });
    const kept = businesses.filter((b) => {
      if (!b.place_id) return false;
      if (b.total_reviews < minReviews) return false;
      if (maxReviews > 0 && b.total_reviews > maxReviews) return false;
      // Rating ceiling: keep unknown ratings (don't drop on missing data).
      if (maxRating > 0 && b.rating != null && b.rating > maxRating) return false;
      if (minOneStarPct > 0 && oneStarShare(b) * 100 < minOneStarPct) return false;
      if (excludeTypes.length && b.type) {
        const t = b.type.toLowerCase();
        if (excludeTypes.some((kw) => t.includes(kw))) return false;
      }
      return true;
    });

    return NextResponse.json({
      query,
      discovered: businesses.length,
      kept: kept.length,
      businesses: kept,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "discovery failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
