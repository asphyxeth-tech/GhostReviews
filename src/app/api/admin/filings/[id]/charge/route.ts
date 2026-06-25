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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Build the plain-language pre-charge notice the operator sends to the customer
// BEFORE we actually bill, so "you'll see each removal before we charge" is
// honored. Amounts are shown in the client's currency from the major-unit fee.
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
    `Per our success-fee agreement, we'll charge ${amount} for this confirmed removal to the card on file. You'll receive an itemized Stripe receipt.`,
    ``,
    `If anything looks off, reply before we process it.`,
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

  // Pull just enough to render the pre-charge notice for the operator. (The
  // billing engine re-loads + re-guards everything itself; this is display-only.)
  let customerNotice = "Confirmed Google review removal — success fee will be charged to the card on file.";
  const sb = createSupabaseAdmin();
  if (sb) {
    const { data: filing } = await sb
      .from("filings")
      .select("place_id, author_name, posted_at, business_name")
      .eq("id", filingId)
      .maybeSingle();
    if (filing) {
      const { data: client } = await sb
        .from("clients")
        .select("fee_per_removal, currency")
        .eq("place_id", filing.place_id)
        .maybeSingle();
      customerNotice = buildCustomerNotice({
        businessName: filing.business_name ?? null,
        author: filing.author_name ?? null,
        postedAt: filing.posted_at ?? null,
        feeDollars: client?.fee_per_removal != null ? Number(client.fee_per_removal) : null,
        currency: (client?.currency as string) || "cad",
      });
    }
  }

  // TODO: send this `customerNotice` automatically once Resend is wired — until
  // then the operator copies it from the response and emails it manually so the
  // "you see each removal before we charge" promise is kept operationally.

  // --- Delegate to the billing engine -------------------------------------
  const result = await chargeRemoval({ filingId });

  // Surface the result as-is plus the notice. A structured failure (declined,
  // guard, SCA) comes back as ok:false with a 200 so the UI can render the
  // detail; a hard server/config problem is a 500.
  if (!result.ok && (result.kind === "config" || result.kind === "error")) {
    return NextResponse.json({ ...result, customerNotice }, { status: 500 });
  }
  return NextResponse.json({ ...result, customerNotice });
}
