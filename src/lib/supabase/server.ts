import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * True when the Supabase env vars are present. The whole auth/persistence
 * layer is optional — without the vars the app behaves exactly like the
 * pre-Supabase version (anonymous scans, nothing saved).
 */
export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Returns null when Supabase isn't configured so callers can skip
 * persistence gracefully instead of crashing.
 */
export async function createSupabaseServer() {
  if (!supabaseConfigured()) return null;

  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components can't set cookies — the middleware
            // refresh handles that path. Safe to ignore here.
          }
        },
      },
    },
  );
}
