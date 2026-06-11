import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Where the magic-link email lands. Handles both link formats Supabase
 * can send (PKCE `code` and OTP `token_hash`), establishes the session
 * cookie, and forwards to the dashboard.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const next = url.searchParams.get("next") ?? "/dashboard";

  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  const supabase = await createSupabaseServer();
  if (!supabase) return redirectTo("/login");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectTo(next);
  } else if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type: "email",
      token_hash: tokenHash,
    });
    if (!error) return redirectTo(next);
  }

  // Expired or already-used link — back to login to request a fresh one.
  return redirectTo("/login");
}
