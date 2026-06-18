// Admin access + service-role helpers for the dev prospecting dashboard.
//
// Access model: the operator signs in with the existing magic-link auth, and
// the /admin area is gated to emails in the ADMIN_EMAILS allowlist. Admin API
// routes additionally use a service-role Supabase client to read/write the
// internal `prospect_scans` flywheel table (which has RLS-on / no public
// policies). Server-only — never import this into a client component.
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "./supabase/server";

/** Lower-cased admin email allowlist from env (comma-separated). */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns the signed-in user IF they're an admin, else null. Gate every
 * admin page and API route on this. Returns null when Supabase isn't
 * configured, the user isn't signed in, ADMIN_EMAILS is empty, or the user's
 * email isn't on the allowlist.
 */
export async function getAdminUser(): Promise<{ id: string; email: string } | null> {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const admins = getAdminEmails();
  if (admins.length === 0 || !admins.includes(user.email.toLowerCase())) {
    return null;
  }
  return { id: user.id, email: user.email };
}

/**
 * Service-role Supabase client — bypasses RLS, for the admin routes to
 * read/write `prospect_scans`. Returns null when the service key isn't
 * configured. NEVER expose this client or its key to the browser.
 */
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
