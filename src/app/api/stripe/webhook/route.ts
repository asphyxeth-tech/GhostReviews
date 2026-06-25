// POST /api/stripe/webhook — receives Stripe events. EVERY request is verified
// against STRIPE_WEBHOOK_SECRET before we trust a byte of it (an attacker could
// otherwise POST fake "card saved" events). The raw body is required for
// signature verification, so we read req.text() and never JSON.parse first.
//
// Phase A handles checkout.session.completed (setup mode) → save the card + mark
// the client active. Phase B adds the success-fee charge flow (charges are
// triggered admin-side via /api/admin/filings/[id]/charge, but Stripe still
// delivers payment_intent.* / invoice.* / charge.refunded events here at least
// once, so this route must be idempotent against retries).
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

  // ---- Idempotency ledger (CRITICAL) -------------------------------------
  // Stripe delivers every event AT LEAST ONCE — the same event id can arrive
  // multiple times (retries after a slow/5xx response, network blips, etc.).
  // Before running ANY side effect we record this event id in `stripe_events`.
  // The insert uses `on conflict (event_id) do nothing`; if it returns no row,
  // we've already processed this event, so we ack with 200 and stop. This is
  // what makes charge/refund handling safe — without it a retried event could
  // double-process. We .select() so we can tell "inserted" from "already there".
  const { data: ledgerRow, error: ledgerErr } = await sb
    .from("stripe_events")
    .upsert(
      { event_id: event.id, type: event.type },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id")
    .maybeSingle();
  if (ledgerErr) {
    // Couldn't record the event — return 500 so Stripe retries rather than
    // risk processing without an idempotency record.
    console.error("[stripe webhook] ledger insert failed:", ledgerErr);
    return NextResponse.json({ error: "ledger error" }, { status: 500 });
  }
  if (!ledgerRow) {
    // Zero rows inserted → this event id was already in the ledger → already
    // handled. Ack immediately without re-running side effects.
    return NextResponse.json({ received: true, duplicate: true });
  }

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
    // The side effect failed AFTER we wrote the idempotency row. Remove that
    // row so Stripe's retry isn't mistaken for a duplicate and actually
    // re-runs the handler. (Our handlers are themselves idempotent — e.g.
    // marking the same client active twice is a no-op — so re-running is safe.)
    await sb.from("stripe_events").delete().eq("event_id", event.id);
    // Returning 500 tells Stripe to retry.
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
