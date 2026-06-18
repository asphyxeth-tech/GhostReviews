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
    const minReviews = Number(body.minReviews) || 0;

    const businesses = await discoverBusinesses(query, { limit, region });
    const kept = businesses.filter(
      (b) => b.place_id && b.total_reviews >= minReviews,
    );

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
