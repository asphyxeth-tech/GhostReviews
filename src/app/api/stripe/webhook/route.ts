// POST /api/stripe/webhook — receives Stripe events. EVERY request is verified
// against STRIPE_WEBHOOK_SECRET before we trust a byte of it (an attacker could
// otherwise POST fake "card saved" events). The raw body is required for
// signature verification, so we read req.text() and never JSON.parse first.
//
// Phase A handles checkout.session.completed (setup mode) → save the card + mark
// the client active. Phase B will add payment_intent.* handling for charges.
import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/admin";
import { getStripe, getWebhookSecret } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = getWebhookSecret();
  if (!stripe || !secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new NextResponse("missing signature", { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return new NextResponse("invalid signature", { status: 400 });
  }

  const sb = createSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "store not configured" }, { status: 500 });

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "setup" && session.setup_intent) {
        // Target the EXACT client this session was created for (set in the
        // checkout route's metadata) — never update by customer id alone.
        const clientId = session.metadata?.client_id;
        if (!clientId) {
          console.error("[stripe webhook] setup session missing client_id metadata");
          return NextResponse.json({ received: true });
        }
        const setupIntentId =
          typeof session.setup_intent === "string"
            ? session.setup_intent
            : session.setup_intent.id;
        const si = await stripe.setupIntents.retrieve(setupIntentId);
        const pm =
          typeof si.payment_method === "string"
            ? si.payment_method
            : si.payment_method?.id;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;

        if (pm && customerId) {
          // Verify the targeted client actually belongs to this Stripe customer
          // before activating — defense against a spoofed/mismatched metadata id.
          const { data: client } = await sb
            .from("clients")
            .select("id, stripe_customer_id")
            .eq("id", clientId)
            .maybeSingle();
          if (!client || client.stripe_customer_id !== customerId) {
            console.error(
              "[stripe webhook] client/customer mismatch; not activating",
            );
            return NextResponse.json({ received: true });
          }

          // Make the saved card the customer's default for future off-session
          // (Phase B) charges.
          await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: pm },
          });
          await sb
            .from("clients")
            .update({
              stripe_payment_method_id: pm,
              status: "active",
              authorized_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", client.id);
        }
      }
    }
    // Other event types are acknowledged and ignored (Phase B adds payment_intent.*).
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    // Returning 500 tells Stripe to retry — safe because our handlers are
    // idempotent (updating the same client to active twice is a no-op).
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
