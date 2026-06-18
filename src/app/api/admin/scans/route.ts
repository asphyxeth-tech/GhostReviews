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
    candidates: rows.filter((s) => (s.prefilter_score ?? 0) >= 50).length,
    recurring_authors: recurring,
    recent: rows.slice(0, 100),
  });
}
