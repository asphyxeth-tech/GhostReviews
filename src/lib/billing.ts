// ghost.reviews — billing engine (Phase B: the success-fee charge flow).
//
// THE MODEL IN ONE SENTENCE: we charge a client EXACTLY ONCE for EXACTLY ONE
// confirmed Google review removal, off-session, against a card they already
// authorized — and we only ever do it after the removal is confirmed.
//
// This file is the single source of truth for turning a `filings` row whose
// status is 'removed' into a paid Stripe Invoice, and for refunding that charge
// if Google later reinstates the review. Everything here is built around three
// layers of double-charge protection:
//
//   1. The DB guard: `removal_charges.filing_id` is UNIQUE and
//      `removal_charges.idempotency_key` is UNIQUE — one charge row per filing,
//      period. We upsert a 'pending' row keyed on the filing before talking to
//      Stripe; if a 'succeeded' charge already exists we return it untouched.
//   2. The Stripe idempotency key: every create call passes
//      `idempotencyKey = "removal:<filing_id>"`, so even a retried request can't
//      produce a second charge at Stripe's side.
//   3. The three-part business guard (see `chargeRemoval`): we refuse to charge
//      unless the filing is confirmed removed AND the client has a saved card
//      AND the client's manager access is active. No exceptions.
//
// Server-only. Never import into a client component (uses the secret Stripe key
// and the service-role Supabase client).
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createSupabaseAdmin } from "@/lib/admin";

// Stripe's minimum charge for CAD/USD is 50 cents. A charge below this would be
// rejected, so we refuse it ourselves with a clear message.
const STRIPE_MIN_MINOR = 50;
// Sanity ceiling so a misconfigured fee can't fire off a five-figure charge.
// Our success fee is per-removal and lives in the low hundreds of dollars; this
// is a guard rail, not a product limit. (CAD $5,000.)
const MAX_MINOR = 500_000;

const STATEMENT_DESCRIPTOR = "GHOSTREVIEWS REMOVAL"; // 20 chars, <= 22 limit.
const CHARGE_DESCRIPTION = "Confirmed Google review removal — success fee";

/** Dollars (major units) → integer cents (minor units). The ONLY place we cross
 *  this boundary. `fee_per_removal` is stored in dollars; Stripe wants cents. */
export function toMinor(feeDollars: number): number {
  return Math.round(feeDollars * 100);
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

// The slice of the filing we need.
type FilingRow = {
  id: string;
  place_id: string;
  review_id: string | null;
  status: string;
  author_name: string | null;
  posted_at: string | null;
  business_name: string | null;
};

// The slice of the client we need to decide + execute a charge.
type ClientRow = {
  id: string;
  place_id: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  access_status: string | null;
  fee_per_removal: number | string | null;
  currency: string | null;
};

// A removal_charges row (the fields we read back / surface).
type ChargeRow = {
  id: string;
  filing_id: string;
  status: string;
  amount_minor: number;
  currency: string;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  last_error: string | null;
};

// What every billing call returns. `ok` is the happy path; everything else is a
// structured failure the admin UI can render without anything throwing.
export type ChargeResult =
  | {
      ok: true;
      status: "succeeded" | "already_charged";
      charge: ChargeRow;
      amountMinor: number;
      currency: string;
    }
  | {
      // A real, surfaceable problem (guard failed, decline, SCA needed, etc.).
      // `kind` lets the UI/route distinguish "we refused" from "Stripe declined".
      ok: false;
      kind:
        | "guard" // three-part guard not satisfied — we never called Stripe
        | "config" // Stripe/Supabase not configured
        | "not_found" // filing or client missing
        | "amount" // amount below Stripe min or above our ceiling
        | "declined" // card declined / insufficient funds
        | "action_required" // SCA — needs a hosted action; see hostedInvoiceUrl
        | "error"; // anything else
      error: string;
      // Present for action_required / declined when Stripe gave us a link the
      // customer can use to complete or retry the payment themselves.
      hostedInvoiceUrl?: string;
      charge?: ChargeRow | null;
    };

export type RefundResult =
  | { ok: true; status: "refunded" | "nothing_to_refund"; charge?: ChargeRow }
  | { ok: false; kind: "config" | "not_found" | "error"; error: string };

// ---------------------------------------------------------------------------
// Charge a confirmed removal
// ---------------------------------------------------------------------------

/**
 * Charge the success fee for ONE confirmed removal.
 *
 * Flow:
 *   a. Load the filing, then its client (resolved by place_id — UNIQUE on both).
 *   b. THREE-PART GUARD: filing.status === 'removed' AND a saved card AND
 *      access_status === 'active'. Refuse otherwise (no Stripe call).
 *   c. Compute amount in minor units from fee_per_removal; bound-check it.
 *   d. Upsert a 'pending' removal_charges row keyed by filing (UNIQUE). If a
 *      'succeeded' charge already exists, return it (idempotent — no re-charge).
 *   e. Bill via a Stripe Invoice (itemized receipt + audit trail), paid
 *      off-session against the saved card, with idempotencyKey = "removal:<id>".
 *   f. Persist the outcome: succeeded / failed (+ last_error) / action_required.
 *      Never throws on a decline or SCA — returns a structured failure instead.
 */
export async function chargeRemoval({
  filingId,
}: {
  filingId: string;
}): Promise<ChargeResult> {
  const stripe = getStripe();
  const sb = createSupabaseAdmin();
  if (!stripe || !sb) {
    return { ok: false, kind: "config", error: "Billing is not configured (Stripe or Supabase keys missing)." };
  }

  // --- a. Load filing + client -------------------------------------------
  const { data: filing, error: fErr } = await sb
    .from("filings")
    .select("id, place_id, review_id, status, author_name, posted_at, business_name")
    .eq("id", filingId)
    .maybeSingle<FilingRow>();
  if (fErr) return { ok: false, kind: "error", error: fErr.message };
  if (!filing) return { ok: false, kind: "not_found", error: "Filing not found." };

  const { data: client, error: cErr } = await sb
    .from("clients")
    .select(
      "id, place_id, stripe_customer_id, stripe_payment_method_id, access_status, fee_per_removal, currency",
    )
    .eq("place_id", filing.place_id)
    .maybeSingle<ClientRow>();
  if (cErr) return { ok: false, kind: "error", error: cErr.message };
  if (!client) {
    return {
      ok: false,
      kind: "not_found",
      error: "No billing client is set up for this business — onboard the client (card + access) first.",
    };
  }

  // --- b. THREE-PART GUARD (never charge without all three) --------------
  if (filing.status !== "removed") {
    return {
      ok: false,
      kind: "guard",
      error: `Refusing to charge: filing status is "${filing.status}", not "removed". We only charge on a confirmed removal.`,
    };
  }
  if (!client.stripe_customer_id || !client.stripe_payment_method_id) {
    return {
      ok: false,
      kind: "guard",
      error: "Refusing to charge: this client has no card on file (not billing-ready).",
    };
  }
  if (client.access_status !== "active") {
    return {
      ok: false,
      kind: "guard",
      error: `Refusing to charge: client access_status is "${client.access_status ?? "none"}", not "active".`,
    };
  }

  // --- c. Amount (dollars → minor units) ---------------------------------
  const feeDollars = Number(client.fee_per_removal);
  if (!Number.isFinite(feeDollars) || feeDollars <= 0) {
    return { ok: false, kind: "amount", error: "Client has no valid fee_per_removal configured." };
  }
  const amountMinor = toMinor(feeDollars);
  const currency = (client.currency || "cad").toLowerCase();
  if (amountMinor < STRIPE_MIN_MINOR) {
    return { ok: false, kind: "amount", error: `Fee ${amountMinor}¢ is below Stripe's minimum (${STRIPE_MIN_MINOR}¢).` };
  }
  if (amountMinor > MAX_MINOR) {
    return { ok: false, kind: "amount", error: `Fee ${amountMinor}¢ exceeds the safety ceiling (${MAX_MINOR}¢) — check fee_per_removal.` };
  }

  const idempotencyKey = `removal:${filing.id}`;

  // --- d. Reserve the charge row (DB-level double-charge guard) ----------
  // If a charge row already exists for this filing, inspect it: a prior
  // 'succeeded' means we're done (return it, no re-charge). A prior 'pending'
  // or 'failed' is safe to (re)attempt — the Stripe idempotency key keeps a
  // genuine retry from duplicating, while a fresh attempt after a transient
  // failure proceeds. We always re-stamp it to 'pending' before charging.
  const { data: existing } = await sb
    .from("removal_charges")
    .select("id, filing_id, status, amount_minor, currency, stripe_payment_intent_id, stripe_invoice_id, last_error")
    .eq("filing_id", filing.id)
    .maybeSingle<ChargeRow>();

  if (existing && existing.status === "succeeded") {
    return {
      ok: true,
      status: "already_charged",
      charge: existing,
      amountMinor: existing.amount_minor,
      currency: existing.currency,
    };
  }

  // Upsert the pending row (insert on first attempt, update on retry). The
  // UNIQUE filing_id / idempotency_key make this the canonical row for this
  // filing no matter how many times we're called.
  const { data: pending, error: upErr } = await sb
    .from("removal_charges")
    .upsert(
      {
        client_id: client.id,
        filing_id: filing.id,
        place_id: filing.place_id,
        review_id: filing.review_id,
        amount_minor: amountMinor,
        currency,
        status: "pending",
        idempotency_key: idempotencyKey,
        last_error: null,
      },
      { onConflict: "filing_id" },
    )
    .select("id, filing_id, status, amount_minor, currency, stripe_payment_intent_id, stripe_invoice_id, last_error")
    .single<ChargeRow>();
  if (upErr || !pending) {
    return { ok: false, kind: "error", error: upErr?.message || "Could not reserve the charge row." };
  }

  // Metadata travels with the invoice + line item so the receipt and our
  // Stripe dashboard always say WHICH review this paid for (auditability).
  const metadata: Stripe.MetadataParam = {
    filing_id: filing.id,
    place_id: filing.place_id,
    review_id: filing.review_id ?? "",
    review_author: filing.author_name ?? "",
    review_posted_at: filing.posted_at ?? "",
    business_name: filing.business_name ?? "",
    product: "success-fee-removal",
  };

  // --- e. Bill via an itemized Invoice (preferred — gives a real receipt) -
  try {
    const customerId = client.stripe_customer_id;
    const paymentMethod = client.stripe_payment_method_id;

    // 1) One pending invoice item: the single removal we're billing for.
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        amount: amountMinor,
        currency,
        description: CHARGE_DESCRIPTION,
        quantity: 1,
        metadata,
      },
      { idempotencyKey: `${idempotencyKey}:item` },
    );

    // 2) Create the invoice from that pending item, charge automatically
    //    off-session against the saved card.
    const invoice = await stripe.invoices.create(
      {
        customer: customerId,
        collection_method: "charge_automatically",
        default_payment_method: paymentMethod,
        auto_advance: true,
        pending_invoice_items_behavior: "include",
        description: CHARGE_DESCRIPTION,
        statement_descriptor: STATEMENT_DESCRIPTOR,
        metadata,
      },
      { idempotencyKey: `${idempotencyKey}:invoice` },
    );

    const invoiceId = invoice.id;

    // 3) Finalize + pay off-session. `pay` confirms the PaymentIntent; if the
    //    card needs SCA it throws an authentication_required card error which
    //    we handle below.
    let paid = invoice;
    if (invoice.status === "draft" && invoiceId) {
      paid = await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: true });
    }
    if (paid.status !== "paid" && invoiceId) {
      paid = await stripe.invoices.pay(
        invoiceId,
        { off_session: true },
        { idempotencyKey: `${idempotencyKey}:pay` },
      );
    }

    // Pull the PaymentIntent id for the refund path. In this API version it
    // hangs off the invoice's payment records, so re-retrieve with expansion to
    // capture it reliably.
    const paymentIntentId = await resolveInvoicePaymentIntentId(stripe, paid);

    if (paid.status === "paid") {
      const { data: updated } = await sb
        .from("removal_charges")
        .update({
          status: "succeeded",
          stripe_invoice_id: invoiceId,
          stripe_payment_intent_id: paymentIntentId,
          charged_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", pending.id)
        .select("id, filing_id, status, amount_minor, currency, stripe_payment_intent_id, stripe_invoice_id, last_error")
        .single<ChargeRow>();
      return {
        ok: true,
        status: "succeeded",
        charge: updated ?? { ...pending, status: "succeeded", stripe_invoice_id: invoiceId ?? null, stripe_payment_intent_id: paymentIntentId },
        amountMinor,
        currency,
      };
    }

    // Invoice exists but isn't paid (e.g. 'open' awaiting action). Treat as a
    // surfaceable failure with the hosted link so the operator/customer can act.
    await sb
      .from("removal_charges")
      .update({
        status: "failed",
        stripe_invoice_id: invoiceId,
        stripe_payment_intent_id: paymentIntentId,
        last_error: `Invoice not paid (status: ${paid.status ?? "unknown"}).`,
      })
      .eq("id", pending.id);
    return {
      ok: false,
      kind: "action_required",
      error: `Charge not completed — invoice status is "${paid.status ?? "unknown"}". The customer may need to complete payment.`,
      hostedInvoiceUrl: paid.hosted_invoice_url ?? undefined,
      charge: { ...pending, status: "failed", stripe_invoice_id: invoiceId ?? null, stripe_payment_intent_id: paymentIntentId },
    };
  } catch (err) {
    // Map the Stripe error to a structured, NON-throwing failure.
    return await recordChargeFailure(sb, pending, err, idempotencyKey);
  }
}

// ---------------------------------------------------------------------------
// Refund a charge after a reinstatement
// ---------------------------------------------------------------------------

/**
 * Refund the success fee for a filing that was charged but has since been
 * reinstated by Google. No-op (nothing_to_refund) if there's no succeeded
 * charge for the filing or it was already refunded. Idempotent via the
 * removal:<id>:refund key.
 */
export async function refundRemoval({
  filingId,
}: {
  filingId: string;
}): Promise<RefundResult> {
  const stripe = getStripe();
  const sb = createSupabaseAdmin();
  if (!stripe || !sb) {
    return { ok: false, kind: "config", error: "Billing is not configured (Stripe or Supabase keys missing)." };
  }

  const { data: charge, error } = await sb
    .from("removal_charges")
    .select("id, filing_id, status, amount_minor, currency, stripe_payment_intent_id, stripe_invoice_id, last_error")
    .eq("filing_id", filingId)
    .maybeSingle<ChargeRow>();
  if (error) return { ok: false, kind: "error", error: error.message };

  // Nothing charged, or already refunded → nothing to do (safe to call freely).
  if (!charge || charge.status === "refunded") {
    return { ok: true, status: "nothing_to_refund", charge: charge ?? undefined };
  }
  if (charge.status !== "succeeded") {
    return { ok: true, status: "nothing_to_refund", charge };
  }

  // We need the PaymentIntent to refund. Prefer the stored id; if it's missing
  // (older row), try to derive it from the invoice.
  let paymentIntentId = charge.stripe_payment_intent_id;
  if (!paymentIntentId && charge.stripe_invoice_id) {
    try {
      const inv = await stripe.invoices.retrieve(charge.stripe_invoice_id, {
        expand: ["payments.data.payment.payment_intent"],
      });
      paymentIntentId = await resolveInvoicePaymentIntentId(stripe, inv);
    } catch {
      // fall through to the explicit error below
    }
  }
  if (!paymentIntentId) {
    return {
      ok: false,
      kind: "error",
      error: "Cannot refund: no PaymentIntent id recorded for this charge.",
    };
  }

  try {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `removal:${filingId}:refund` },
    );
    const { data: updated } = await sb
      .from("removal_charges")
      .update({ status: "refunded", refunded_at: new Date().toISOString(), last_error: null })
      .eq("id", charge.id)
      .select("id, filing_id, status, amount_minor, currency, stripe_payment_intent_id, stripe_invoice_id, last_error")
      .single<ChargeRow>();
    return { ok: true, status: "refunded", charge: updated ?? { ...charge, status: "refunded" } };
  } catch (err) {
    const msg = stripeErrorMessage(err);
    await sb.from("removal_charges").update({ last_error: `Refund failed: ${msg}` }).eq("id", charge.id);
    return { ok: false, kind: "error", error: `Refund failed: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// In this Stripe API version the PaymentIntent is reachable via the invoice's
// payment records rather than a top-level field. Re-retrieve with expansion and
// dig out the id. Returns null if it can't be resolved (we still succeed on the
// invoice; the refund path will re-derive or report cleanly).
async function resolveInvoicePaymentIntentId(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<string | null> {
  try {
    const full =
      invoice.payments?.data?.length
        ? invoice
        : invoice.id
          ? await stripe.invoices.retrieve(invoice.id, {
              expand: ["payments.data.payment.payment_intent"],
            })
          : invoice;
    for (const p of full.payments?.data ?? []) {
      const pi = p.payment?.payment_intent;
      if (typeof pi === "string") return pi;
      if (pi && typeof pi === "object" && "id" in pi) return pi.id;
    }
  } catch {
    // best effort
  }
  return null;
}

// Turn a thrown Stripe/unknown error into the structured failure shape and
// persist last_error on the pending row. Never throws.
async function recordChargeFailure(
  sb: NonNullable<ReturnType<typeof createSupabaseAdmin>>,
  pending: ChargeRow,
  err: unknown,
  idempotencyKey: string,
): Promise<ChargeResult> {
  const e = asStripeError(err);
  const message = stripeErrorMessage(err);

  // SCA / authentication required — the card needs an interactive step we can't
  // do off-session. Surface a hosted link if Stripe gave us one.
  if (e?.code === "authentication_required" || e?.code === "payment_intent_authentication_failure") {
    const hosted = hostedUrlFromError(e);
    await sb
      .from("removal_charges")
      .update({ status: "failed", last_error: `Authentication required (SCA): ${message}` })
      .eq("id", pending.id);
    return {
      ok: false,
      kind: "action_required",
      error: `This card requires authentication (SCA) that can't be completed off-session. Send the customer a hosted payment link to finish. (${idempotencyKey})`,
      hostedInvoiceUrl: hosted,
      charge: { ...pending, status: "failed", last_error: message },
    };
  }

  // Card declined / insufficient funds / generic card error.
  if (e?.type === "StripeCardError") {
    await sb
      .from("removal_charges")
      .update({ status: "failed", last_error: `Declined: ${message}` })
      .eq("id", pending.id);
    return {
      ok: false,
      kind: "declined",
      error: `Card declined: ${message}`,
      charge: { ...pending, status: "failed", last_error: message },
    };
  }

  // Anything else (invalid request, API/connection error, unknown).
  await sb
    .from("removal_charges")
    .update({ status: "failed", last_error: message })
    .eq("id", pending.id);
  return {
    ok: false,
    kind: "error",
    error: message,
    charge: { ...pending, status: "failed", last_error: message },
  };
}

// Minimal structural view of a Stripe error so we can branch without relying on
// instanceof across module/bundle boundaries.
type StripeErrorLike = {
  type?: string;
  code?: string;
  decline_code?: string;
  message?: string;
  payment_intent?: unknown;
};

function asStripeError(err: unknown): StripeErrorLike | null {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.type === "string" || typeof e.code === "string") {
      return e as StripeErrorLike;
    }
  }
  return null;
}

function stripeErrorMessage(err: unknown): string {
  const e = asStripeError(err);
  if (e?.message) return e.message;
  if (err instanceof Error) return err.message;
  return "Unknown billing error.";
}

// Some authentication-required errors carry the PaymentIntent (with the invoice
// link or next_action) on the error. Best-effort extraction of a hosted URL.
function hostedUrlFromError(e: StripeErrorLike): string | undefined {
  const pi = e.payment_intent;
  if (pi && typeof pi === "object") {
    const obj = pi as Record<string, unknown>;
    const inv = obj.invoice;
    if (inv && typeof inv === "object" && "hosted_invoice_url" in inv) {
      const url = (inv as Record<string, unknown>).hosted_invoice_url;
      if (typeof url === "string") return url;
    }
  }
  return undefined;
}
