// POST /api/admin/filings/[id]/charge — admin-triggered success-fee charge.
//
// This is the ONLY place a charge is initiated, and it is deliberately manual:
// the operator clicks "Charge success fee" on a filing that's confirmed removed.
// Two safety rails sit on top of the billing engine's own three-part guard:
//
//   1. Admin gate — only ADMIN_EMAILS users can hit this.
//   2. Explicit confirm flag — the body MUST contain { confirm: true }. We never
//      auto-charge. This keeps the product promise that the customer sees every
//      removal before we bill it. The response also returns a `customerNotice`:
//      a ready-to-send pre-charge note the operator emails manually for now.
//
// All the real billing logic (guards, idempotency, Stripe Invoice, error
// mapping) lives in `@/lib/billing` — this route just gates + delegates.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser, createSupabaseAdmin } from "@/lib/admin";
import { chargeRemoval } from "@/lib/billing";
import { sendEmail, isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Build the plain-language charge-confirmation notice for the customer. We only
// ever charge on a CONFIRMED removal, so this is worded as a transparent
// receipt ("Google removed it → here's what we charged"). When Resend is
// configured we email it to the client automatically; otherwise it's returned
// for the operator to send by hand. Amounts use the client's currency.
function buildCustomerNotice(opts: {
  businessName: string | null;
  author: string | null;
  postedAt: string | null;
  feeDollars: number | null;
  currency: string;
}): string {
  const biz = opts.businessName || "your business";
  const who = opts.author ? `by ${opts.author}` : "";
  const when = opts.postedAt ? ` (posted ${opts.postedAt})` : "";
  const amount =
    opts.feeDollars != null
      ? `${opts.currency.toUpperCase()} $${opts.feeDollars.toFixed(2)}`
      : "your agreed success fee";
  return [
    `Good news — Google has removed the flagged review ${who}${when} for ${biz}.`,
    ``,
    `Per our success-fee agreement, we've charged ${amount} for this confirmed removal to the card on file. An itemized Stripe receipt is on its way to you.`,
    ``,
    `You can verify the removal on your own Google profile any time. If anything looks off, just reply to this email and we'll sort it out.`,
    ``,
    `— Devon, Ghost Reviews`,
  ].join("\n");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  // --- Admin gate ---------------------------------------------------------
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: filingId } = await ctx.params;
  if (!filingId) {
    return NextResponse.json({ error: "filing id is required" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
  // --- Explicit confirm (never silent auto-charge) ------------------------
  if (body.confirm !== true) {
    return NextResponse.json(
      {
        error:
          "Charge not confirmed. Re-send with { confirm: true } after reviewing the customer notice.",
      },
      { status: 400 },
    );
  }

  // Pull just enough to render the customer notice + know where to email it. (The
  // billing engine re-loads + re-guards everything itself; this is display-only.)
  let customerNotice = "Confirmed Google review removal — success fee charged to the card on file.";
  let businessName: string | null = null;
  let contactEmail: string | null = null;
  const sb = createSupabaseAdmin();
  if (sb) {
    const { data: filing } = await sb
      .from("filings")
      .select("place_id, author_name, posted_at, business_name")
      .eq("id", filingId)
      .maybeSingle();
    if (filing) {
      businessName = (filing.business_name as string) ?? null;
      const { data: client } = await sb
        .from("clients")
        .select("fee_per_removal, currency, contact_email")
        .eq("place_id", filing.place_id)
        .maybeSingle();
      contactEmail =
        client?.contact_email && typeof client.contact_email === "string"
          ? client.contact_email
          : null;
      customerNotice = buildCustomerNotice({
        businessName,
        author: filing.author_name ?? null,
        postedAt: filing.posted_at ?? null,
        feeDollars: client?.fee_per_removal != null ? Number(client.fee_per_removal) : null,
        currency: (client?.currency as string) || "cad",
      });
    }
  }

  // --- Delegate to the billing engine -------------------------------------
  const result = await chargeRemoval({ filingId });

  // On a FRESH success, send the customer their confirmation automatically (if
  // Resend is configured and we have an address). "already_charged" was emailed
  // on its first run, so we don't re-send. If email isn't configured the
  // operator still gets `customerNotice` in the response to send by hand.
  let emailed = false;
  let emailReason: string | undefined;
  if (result.ok && result.status === "succeeded") {
    if (!isEmailConfigured()) {
      emailReason = "email_not_configured";
    } else if (!contactEmail) {
      emailReason = "no_contact_email";
    } else {
      const sent = await sendEmail({
        to: contactEmail,
        subject: `Review removed — your Ghost Reviews success fee${businessName ? ` (${businessName})` : ""}`,
        text: customerNotice,
      });
      emailed = sent.sent;
      if (!sent.sent) emailReason = sent.reason;
    }
  }

  // Surface the result as-is plus the notice + whether we emailed it. A
  // structured failure (declined, guard, SCA) comes back as ok:false with a 200
  // so the UI can render the detail; a hard server/config problem is a 500.
  const payload = { ...result, customerNotice, emailed, emailReason };
  if (!result.ok && (result.kind === "config" || result.kind === "error")) {
    return NextResponse.json(payload, { status: 500 });
  }
  return NextResponse.json(payload);
}
