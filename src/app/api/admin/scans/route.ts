// GET /api/admin/scans — admin-only. Reads the prospect_scans flywheel and
// computes the cross-business reviewer convergence (the free "serial bomber"
// signal): accounts flagged across >= 2 distinct businesses.
import { NextResponse } from "next/server";
import { getAdminUser, createSupabaseAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FlaggedRow = { author_id?: unknown; author_name?: unknown };

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sb = createSupabaseAdmin();
  if (!sb) {
    return NextResponse.json(
      { error: "flywheel store not configured (set SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const { data, error } = await sb
    .from("prospect_scans")
    .select(
      "id, place_id, business_name, prefilter_score, anchor_fired, rules_fired, total_reviews, flagged_reviews, scanned_at",
    )
    .order("scanned_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Latest scan per business (rows are newest-first, so the first one we see for
  // a place_id wins). This is the deduped set the dashboard browses — re-scans
  // collapse to the most recent result instead of piling up.
  const latestByPlace = new Map<string, (typeof rows)[number]>();
  for (const s of rows) {
    const key = s.place_id || s.id;
    if (!latestByPlace.has(key)) latestByPlace.set(key, s);
  }
  const businesses = [...latestByPlace.values()];

  // Saved leads: the deduped candidates (score >= 50), highest first. Each one
  // links through to its per-business "file" page, so they survive a reload.
  const leads = businesses
    .filter((s) => (s.prefilter_score ?? 0) >= 50)
    .map((s) => ({
      place_id: s.place_id,
      business_name: s.business_name,
      prefilter_score: s.prefilter_score ?? 0,
      rules_fired: Array.isArray(s.rules_fired) ? (s.rules_fired as string[]) : [],
      flagged_count: Array.isArray(s.flagged_reviews) ? s.flagged_reviews.length : 0,
      total_reviews: s.total_reviews ?? null,
      scanned_at: s.scanned_at,
    }))
    .sort((a, b) => b.prefilter_score - a.prefilter_score);

  // Convergence: group flagged author_ids across distinct businesses.
  const byAuthor = new Map<
    string,
    { name: string; places: Set<string>; businesses: Set<string> }
  >();
  for (const s of rows) {
    const flagged = Array.isArray(s.flagged_reviews)
      ? (s.flagged_reviews as FlaggedRow[])
      : [];
    for (const fr of flagged) {
      const aid = typeof fr.author_id === "string" ? fr.author_id : "";
      if (!aid) continue;
      let entry = byAuthor.get(aid);
      if (!entry) {
        entry = {
          name: typeof fr.author_name === "string" ? fr.author_name : aid,
          places: new Set(),
          businesses: new Set(),
        };
        byAuthor.set(aid, entry);
      }
      if (s.place_id) entry.places.add(s.place_id);
      if (s.business_name) entry.businesses.add(s.business_name);
    }
  }
  const recurring = [...byAuthor.entries()]
    .map(([author_id, v]) => ({
      author_id,
      author_name: v.name,
      business_count: v.places.size,
      businesses: [...v.businesses],
    }))
    .filter((r) => r.business_count >= 2)
    .sort((a, b) => b.business_count - a.business_count);

  return NextResponse.json({
    total_scans: rows.length,
    total_businesses: businesses.length,
    candidates: leads.length,
    leads,
    recurring_authors: recurring,
  });
}
