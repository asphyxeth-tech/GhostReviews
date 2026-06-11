import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/** POST /auth/signout — clears the session and returns home. */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServer();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", new URL(req.url).origin), {
    status: 303,
  });
}
