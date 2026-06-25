// POST /api/onboard/[token]/access — public, but gated by the secret onboarding
// token. The customer clicks "I've sent the invite" on the Manager walkthrough
// (/onboard/[token]/access) and we flip the client's access_status to 'invited'.
//
// This is the customer's SELF-REPORT that they sent us the Google Manager
// invite. It does NOT mean we have access yet — an admin still has to accept the
// invite on our side and confirm it (that flips access_status -> 'active' via the
// admin route). We never imply special Google access; 'invited' just tells the
// operator there's an invite waiting to be accepted.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });

  // Public, token-gated route — throttle to prevent spam toggling.
  const limit = await checkRateLimit("onboard_access", clientIp(req), {
    perIp: 20,
    windowMin: 60,
  });
  if (!limit.ok) return NextResponse.json({ error: limit.reason }, { status: 429 });

  const sb = createSupabaseAdmin();
  if (!sb)
    return NextResponse.json({ error: "store not configured" }, { status: 500 });

  const { data: client } = await sb
    .from("clients")
    .select("id, access_status, onboarding_token_expires_at")
    .eq("onboarding_token", token)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Reject expired links.
  if (
    client.onboarding_token_expires_at &&
    new Date(client.onboarding_token_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json(
      { error: "This onboarding link has expired. Please contact us for a new one." },
      { status: 410 },
    );
  }

  // Don't clobber a richer state. If we've already accepted (active) the invite,
  // a stray "I sent the invite" click shouldn't bump us back to 'invited'.
  // Revoked is a deliberate state too — leave it for the admin to manage.
  if (client.access_status === "active" || client.access_status === "revoked") {
    return NextResponse.json({ ok: true, access_status: client.access_status });
  }

  const { error } = await sb
    .from("clients")
    .update({ access_status: "invited" })
    .eq("id", client.id);

  if (error) {
    console.error("[/api/onboard/access] update failed:", error);
    return NextResponse.json(
      { error: "Could not record that. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, access_status: "invited" });
}
