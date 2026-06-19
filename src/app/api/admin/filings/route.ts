// /api/admin/filings — admin-only removal-request tracker.
// GET ?place_id=... lists the filings for one business; POST upserts a filing
// (keyed by place_id + review_id) and stamps submitted_at / resolved_at from the
// status transition. Service-role writes behind the ADMIN_EMAILS gate.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser, createSupabaseAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["drafted", "submitted", "removed", "denied"];

// Snapshot/editable columns we accept from the client (never trust arbitrary
// column names). place_id + review_id are handled separately as the key.
const FIELDS = [
  "business_name",
  "author_name",
  "rating",
  "posted_at",
  "text_snippet",
  "review_link",
  "status",
  "removal_reason",
  "notes",
] as const;

type Body = Record<string, unknown>;

function clean(body: Body): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    let v = body[f];
    if (f === "rating") {
      v = v == null || v === "" ? null : Number(v);
      if (v != null && !Number.isFinite(v)) v = null;
    } else if (typeof v === "string") {
      v = v.trim();
    }
    out[f] = v;
  }
  return out;
}

async function gate() {
  const admin = await getAdminUser();
  if (!admin)
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const sb = createSupabaseAdmin();
  if (!sb)
    return {
      error: NextResponse.json(
        { error: "store not configured (set SUPABASE_SERVICE_ROLE_KEY)" },
        { status: 500 },
      ),
    };
  return { admin, sb };
}

export async function GET(req: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;
  const placeId = req.nextUrl.searchParams.get("place_id") || "";
  if (!placeId)
    return NextResponse.json({ error: "place_id is required" }, { status: 400 });
  const { data, error } = await g.sb
    .from("filings")
    .select("*")
    .eq("place_id", placeId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ filings: data ?? [] });
}

export async function POST(req: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;

  const raw = (await req.json().catch(() => ({}))) as Body;
  const placeId = typeof raw.place_id === "string" ? raw.place_id : "";
  const reviewId = typeof raw.review_id === "string" ? raw.review_id : "";
  if (!placeId || !reviewId)
    return NextResponse.json(
      { error: "place_id and review_id are required" },
      { status: 400 },
    );

  const fields = clean(raw);
  const status =
    typeof fields.status === "string" && STATUSES.includes(fields.status)
      ? (fields.status as string)
      : "drafted";

  // Read the existing filing so the status timestamps only move forward (and
  // reset cleanly if the status is walked back).
  const { data: existing } = await g.sb
    .from("filings")
    .select("submitted_at, resolved_at")
    .eq("place_id", placeId)
    .eq("review_id", reviewId)
    .maybeSingle();

  const now = new Date().toISOString();
  let submitted_at = existing?.submitted_at ?? null;
  let resolved_at = existing?.resolved_at ?? null;
  if (status === "drafted") {
    submitted_at = null;
    resolved_at = null;
  } else if (status === "submitted") {
    submitted_at = submitted_at ?? now;
    resolved_at = null;
  } else {
    // removed | denied
    submitted_at = submitted_at ?? now;
    resolved_at = resolved_at ?? now;
  }

  const row = {
    ...fields,
    place_id: placeId,
    review_id: reviewId,
    status,
    submitted_at,
    resolved_at,
    updated_at: now,
    scanned_by: g.admin.id,
  };

  const { data, error } = await g.sb
    .from("filings")
    .upsert(row, { onConflict: "place_id,review_id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ filing: data });
}
