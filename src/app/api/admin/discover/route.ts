// POST /api/admin/discover — admin-only. Sweep Google Maps (via the FREE Google
// Places Text Search API) across a basket of category seeds for one city, union
// + dedupe, then apply the discovery filters before anything gets scored. Maps
// search is keyword-gated (no "all businesses in a city" mode), so the basket
// IS the broad net.
//
// Google is the ONLY discovery source. The paid Outscraper Maps-search fallback
// was deleted (docs/COST_OVERHAUL.md §3 item 7) — it fired silently whenever
// GOOGLE_MAPS_API_KEY was missing, spending credits on an env-var typo. A
// missing key is now a loud 500, never a quiet charge.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import type { DiscoveredBusiness } from "@/lib/outscraper-search";
import { discoverBusinesses } from "@/lib/google-places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Bound the fan-out so one run can't balloon into dozens of searches.
const MAX_VERTICALS = 16;
const SEARCH_CONCURRENCY = 6;

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Discovery REQUIRES the free Google Places key — fail loudly rather than
  // silently spending paid Outscraper credits (the old fallback behavior).
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(
      { error: "Google discovery not configured — set GOOGLE_MAPS_API_KEY" },
      { status: 500 },
    );
  }

  try {
    const body = await req.json();

    // City + a basket of vertical seeds. Back-compat: a bare `query` still works
    // as a single search term.
    const city =
      (typeof body.city === "string" && body.city.trim()) ||
      (typeof body.query === "string" && body.query.trim()) ||
      "";
    const verticalsRaw: string =
      typeof body.verticals === "string" ? body.verticals : "";
    const verticals = verticalsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_VERTICALS);

    if (!city && verticals.length === 0) {
      return NextResponse.json(
        { error: "city (or query) is required" },
        { status: 400 },
      );
    }

    const limit = Number(body.limit) || 30; // per-vertical
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

    // Build the search terms: "<vertical>, <city>" per seed (or just the city
    // when no basket is given).
    const terms = verticals.length
      ? verticals.map((v) => `${v}, ${city}`)
      : [city];

    // Fan out across the basket with a small concurrency pool; union + dedupe by
    // place_id (first occurrence wins). They poll concurrently, so wall-clock ≈
    // the slowest single search, not the sum.
    const seen = new Set<string>();
    const union: DiscoveredBusiness[] = [];
    let next = 0;
    async function worker() {
      for (;;) {
        const i = next++;
        if (i >= terms.length) break;
        const found = await discoverBusinesses(terms[i], { limit, region });
        for (const b of found) {
          if (b.place_id && !seen.has(b.place_id)) {
            seen.add(b.place_id);
            union.push(b);
          }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(SEARCH_CONCURRENCY, terms.length) }, worker),
    );

    const kept = union.filter((b) => {
      if (!b.place_id) return false;
      if (b.total_reviews < minReviews) return false;
      if (maxReviews > 0 && b.total_reviews > maxReviews) return false;
      // Rating ceiling: keep unknown ratings (don't drop on missing data).
      if (maxRating > 0 && b.rating != null && b.rating > maxRating) return false;
      // 1-star share: only apply when the distribution is available. Google
      // discovery doesn't return reviews_per_score, so this filter is a no-op
      // today — kept (safely guarded) for any future source that provides it.
      if (
        minOneStarPct > 0 &&
        b.reviews_per_score &&
        oneStarShare(b) * 100 < minOneStarPct
      )
        return false;
      if (excludeTypes.length && b.type) {
        const t = b.type.toLowerCase();
        if (excludeTypes.some((kw) => t.includes(kw))) return false;
      }
      return true;
    });

    return NextResponse.json({
      city,
      verticals_searched: terms.length,
      discovery_source: "google",
      discovered: union.length,
      kept: kept.length,
      businesses: kept,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "discovery failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
