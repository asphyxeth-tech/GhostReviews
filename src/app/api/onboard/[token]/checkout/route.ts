// POST /api/onboard/[token]/checkout — public, but gated by the secret onboarding
// token. Creates a Stripe-hosted Checkout session in SETUP mode (saves a card,
// charges nothing) for the client behind this token, and returns the hosted URL
// to redirect to. Card data is entered on Stripe's page — it never touches us.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/admin";
import { getStripe } from "@/lib/stripe";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });

  // Public, token-gated route — throttle to prevent session-creation spam.
  const limit = await checkRateLimit("onboard_checkout", clientIp(req), {
    perIp: 10,
    windowMin: 60,
  });
  if (!limit.ok) return NextResponse.json({ error: limit.reason }, { status: 429 });

  const sb = createSupabaseAdmin();
  const stripe = getStripe();
  if (!sb || !stripe)
    return NextResponse.json({ error: "billing not configured" }, { status: 500 });

  const { data: client } = await sb
    .from("clients")
    .select("id, place_id, stripe_customer_id, status, onboarding_token_expires_at")
    .eq("onboarding_token", token)
    .maybeSingle();
  if (!client || !client.stripe_customer_id)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  // Once a card is on file, the token no longer authorizes new checkouts.
  if (client.status === "active")
    return NextResponse.json(
      { error: "This card is already authorized." },
      { status: 409 },
    );
  // Reject expired onboarding links — they shouldn't be able to start a Stripe
  // session. (Checked after the active-state guard so a returning, already-active
  // client never sees a confusing "expired" error.)
  if (
    client.onboarding_token_expires_at &&
    new Date(client.onboarding_token_expires_at).getTime() < Date.now()
  )
    return NextResponse.json(
      {
        error:
          "This onboarding link has expired. Please contact us for a new one.",
      },
      { status: 410 },
    );

  const origin = req.nextUrl.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: client.stripe_customer_id,
    payment_method_types: ["card"],
    success_url: `${origin}/onboard/${token}/done`,
    cancel_url: `${origin}/onboard/${token}`,
    metadata: { client_id: client.id, place_id: client.place_id, token },
  });

  return NextResponse.json({ url: session.url });
}
