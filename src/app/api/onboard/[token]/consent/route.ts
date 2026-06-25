// POST /api/onboard/[token]/consent — public, but gated by the secret onboarding
// token. Records the customer's documented, digital CONSENT for us to act as a
// Manager on their Google Business Profile and to file policy-violation reports
// on their behalf.
//
// WHY THIS EXISTS (legal): Google's third-party policy AND the FTC both require
// WRITTEN / DIGITAL consent — verbal isn't enough. We store the literal text the
// customer agreed to, a version tag, the timestamp, and their IP + user-agent as
// proof the agreement happened. The customer must also be told they can
// disassociate within 7 business days and that removals are Google's decision
// (the on-page copy carries those statements; this route just records the act).
//
// AuthorizeCard calls this FIRST, before kicking off the Stripe setup checkout,
// so consent is on record even if the customer abandons the card step.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The current consent text version. Bump this whenever the label below changes
// so old records stay attributable to the exact wording the customer saw.
const CONSENT_VERSION = "2026-06-v1";

// The literal label shown next to the checkbox on /onboard/[token]. Kept here as
// the canonical copy so what we STORE always matches what the customer READ.
// (The page renders this same string.)
const CONSENT_TEXT =
  "I authorize Ghost Reviews to act as a Manager on my Google Business Profile and to file policy-violation reports on my behalf. I understand these are requests Google decides on, that I can remove this access at any time, and that Google lets me disassociate within 7 business days.";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });

  // Public, token-gated route — throttle to prevent consent-record spam.
  const ip = clientIp(req);
  const limit = await checkRateLimit("onboard_consent", ip, {
    perIp: 20,
    windowMin: 60,
  });
  if (!limit.ok) return NextResponse.json({ error: limit.reason }, { status: 429 });

  const sb = createSupabaseAdmin();
  if (!sb)
    return NextResponse.json({ error: "store not configured" }, { status: 500 });

  // Resolve the client purely by the secret token (the token IS the access
  // control here — same pattern as the checkout route).
  const { data: client } = await sb
    .from("clients")
    .select("id, status, onboarding_token_expires_at")
    .eq("onboarding_token", token)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Reject expired links — the link reveals fee terms and can start a Stripe
  // setup session, so it shouldn't live forever.
  if (
    client.onboarding_token_expires_at &&
    new Date(client.onboarding_token_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json(
      { error: "This onboarding link has expired. Please contact us for a new one." },
      { status: 410 },
    );
  }

  const userAgent = req.headers.get("user-agent") || null;

  // Record the consent. We store the literal text + version so the record is
  // self-describing forever, even if we later change the wording.
  const { error } = await sb
    .from("clients")
    .update({
      consent_text: CONSENT_TEXT,
      consent_version: CONSENT_VERSION,
      consent_at: new Date().toISOString(),
      consent_ip: ip,
      consent_user_agent: userAgent,
    })
    .eq("id", client.id);

  if (error) {
    console.error("[/api/onboard/consent] update failed:", error);
    return NextResponse.json(
      { error: "Could not record your authorization. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, consent_version: CONSENT_VERSION });
}
