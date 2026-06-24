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

  const { data, error } = await g.sb
    .from("clients")
    .insert({
      place_id: placeId,
      business_name: businessName,
      contact_email: contactEmail,
      fee_per_removal: feePerRemoval,
      stripe_customer_id: customer.id,
      onboarding_token: token,
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
