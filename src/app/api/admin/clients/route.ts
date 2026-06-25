// /api/admin/clients — admin-only. Manage onboarded billing clients.
// GET ?place_id=... → the client (if any) for a business + its onboarding link.
// POST → create a client (and a Stripe customer + secret onboarding token) for a
// business, returning the onboarding URL to send them. Idempotent per place_id:
// if a client already exists, it's returned instead of duplicated.
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAdminUser, createSupabaseAdmin } from "@/lib/admin";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return { admin, sb };
}

function onboardingUrl(req: NextRequest, token: string): string {
  return `${req.nextUrl.origin}/onboard/${token}`;
}

export async function GET(req: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;
  const placeId = req.nextUrl.searchParams.get("place_id") || "";
  if (!placeId)
    return NextResponse.json({ error: "place_id is required" }, { status: 400 });
  const { data } = await g.sb
    .from("clients")
    .select("*")
    .eq("place_id", placeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({
    client: data ?? null,
    onboarding_url: data ? onboardingUrl(req, data.onboarding_token) : null,
  });
}

export async function POST(req: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const placeId = typeof body.place_id === "string" ? body.place_id : "";
  if (!placeId)
    return NextResponse.json({ error: "place_id is required" }, { status: 400 });
  const businessName =
    typeof body.business_name === "string" ? body.business_name : null;
  const contactEmail =
    typeof body.contact_email === "string" ? body.contact_email.trim() : null;
  const fee = Number(body.fee_per_removal);
  const feePerRemoval = Number.isFinite(fee) && fee > 0 ? fee : 100;

  // Idempotent: reuse an existing client for this business instead of creating a
  // duplicate Stripe customer / token.
  const { data: existing } = await g.sb
    .from("clients")
    .select("*")
    .eq("place_id", placeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      client: existing,
      onboarding_url: onboardingUrl(req, existing.onboarding_token),
      reused: true,
    });
  }

  const stripe = getStripe();
  if (!stripe)
    return NextResponse.json(
      { error: "Stripe not configured (set STRIPE_SECRET_KEY)" },
      { status: 500 },
    );

  // Create the Stripe customer up front; the card gets attached during onboarding.
  const customer = await stripe.customers.create({
    name: businessName ?? undefined,
    email: contactEmail ?? undefined,
    metadata: { place_id: placeId },
  });

  const token = randomBytes(24).toString("base64url");
  // Onboarding links expire after 14 days — they reveal business name + fee terms
  // and, pre-auth, let anyone start a Stripe setup session, so they shouldn't
  // live forever. The token routes + onboard pages reject anything past this.
  const tokenExpiresAt = new Date(
    Date.now() + 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await g.sb
    .from("clients")
    .insert({
      place_id: placeId,
      business_name: businessName,
      contact_email: contactEmail,
      fee_per_removal: feePerRemoval,
      stripe_customer_id: customer.id,
      onboarding_token: token,
      onboarding_token_expires_at: tokenExpiresAt,
      status: "pending",
      created_by: g.admin.id,
    })
    .select()
    .single();
  if (error) {
    // Lost a create race (place_id is unique) — return the row that won. The
    // Stripe customer this request created is left orphaned but harmless.
    if (error.code === "23505") {
      const { data: winner } = await g.sb
        .from("clients")
        .select("*")
        .eq("place_id", placeId)
        .maybeSingle();
      if (winner) {
        return NextResponse.json({
          client: winner,
          onboarding_url: onboardingUrl(req, winner.onboarding_token),
          reused: true,
        });
      }
    }
    console.error("[/api/admin/clients] insert failed:", error);
    return NextResponse.json(
      { error: "Could not create the billing client." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    client: data,
    onboarding_url: onboardingUrl(req, token),
  });
}

// PATCH → admin-gated update of a client's Manager-access state. Used by the
// BillingPanel to record what happened on Google's side:
//   action: "accept_access"  → access_status='active',  sets access_granted_at
//   action: "revoke_access"  → access_status='revoked', sets access_revoked_at
// Identify the client by `id` (preferred) or `place_id`.
//
// This is the operator confirming reality (we accepted the invite / access was
// removed). The client's self-reported 'invited' state comes from the public
// /api/onboard/[token]/access route; only the admin can flip it to active.
export async function PATCH(req: NextRequest) {
  const g = await gate();
  if (g.error) return g.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const id = typeof body.id === "string" ? body.id : "";
  const placeId = typeof body.place_id === "string" ? body.place_id : "";
  if (!id && !placeId)
    return NextResponse.json(
      { error: "id or place_id is required" },
      { status: 400 },
    );

  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (action === "accept_access") {
    patch = { access_status: "active", access_granted_at: now };
  } else if (action === "revoke_access") {
    patch = { access_status: "revoked", access_revoked_at: now };
  } else {
    return NextResponse.json(
      { error: "unknown action (expected accept_access | revoke_access)" },
      { status: 400 },
    );
  }

  let q = g.sb.from("clients").update(patch);
  q = id ? q.eq("id", id) : q.eq("place_id", placeId);
  const { data, error } = await q.select().maybeSingle();
  if (error) {
    console.error("[/api/admin/clients PATCH] update failed:", error);
    return NextResponse.json(
      { error: "Could not update access status." },
      { status: 500 },
    );
  }
  if (!data)
    return NextResponse.json({ error: "client not found" }, { status: 404 });

  return NextResponse.json({ client: data });
}
