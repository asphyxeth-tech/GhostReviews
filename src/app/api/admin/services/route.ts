// /api/admin/services — admin-only CRUD for the cost/subscription registry.
// GET (list) / POST (create) / PATCH (update) / DELETE (remove). Service-role
// writes after the ADMIN_EMAILS gate, same pattern as the prospect routes.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser, createSupabaseAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whitelist of editable columns — never trust the client to name arbitrary ones.
const FIELDS = [
  "name",
  "category",
  "website",
  "manage_url",
  "billing_model",
  "monthly_cost",
  "currency",
  "status",
  "wired",
  "notes",
] as const;

type ServiceInput = Record<string, unknown>;

function clean(body: ServiceInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    let v = body[f];
    if (f === "monthly_cost") {
      v = v === "" || v == null ? null : Number(v);
      if (v != null && !Number.isFinite(v)) v = null;
    } else if (f === "wired") {
      v = Boolean(v);
    } else if (typeof v === "string") {
      v = v.trim();
    }
    out[f] = v;
  }
  return out;
}

async function gate() {
  const admin = await getAdminUser();
  if (!admin) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const sb = createSupabaseAdmin();
  if (!sb)
    return {
      error: NextResponse.json(
        { error: "store not configured (set SUPABASE_SERVICE_ROLE_KEY)" },
        { status: 500 },
      ),
    };
  return { sb };
}

export async function GET() {
  const g = await gate();
  if (g.error) return g.error;
  const { data, error } = await g.sb
    .from("services")
    .select("*")
    .order("status", { ascending: true })
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ services: data ?? [] });
}

export async function POST(req: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;
  const body = clean(await req.json().catch(() => ({})));
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const { data, error } = await g.sb.from("services").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service: data });
}

export async function PATCH(req: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;
  const raw = (await req.json().catch(() => ({}))) as ServiceInput;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const body = clean(raw);
  body.updated_at = new Date().toISOString();
  const { data, error } = await g.sb
    .from("services")
    .update(body)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service: data });
}

export async function DELETE(req: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;
  const raw = (await req.json().catch(() => ({}))) as ServiceInput;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { error } = await g.sb.from("services").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
