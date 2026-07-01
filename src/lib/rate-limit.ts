// Lightweight rate limiting for the public scan endpoints, backed by the
// existing Supabase (no new infra). Counts recent rows per IP and globally in a
// `rate_events` table via the service role.
//
// FAIL-OPEN vs FAIL-CLOSED — the important nuance:
//   - When the limiter is entirely UNCONFIGURED (no service key / table), we
//     fail OPEN on EVERY bucket: a scan is never blocked just because the
//     limiter isn't wired up yet. The documented backstop in that state is the
//     dashboard spend caps (Anthropic / Outscraper / Stripe), not this table.
//   - When the limiter IS configured but a query ERRORS, behavior splits by
//     bucket. Free buckets (the public scan) fail OPEN — a transient Supabase
//     blip shouldn't deny a free lead-gen scan. PAID buckets (the deep Tower
//     audit, the Stripe checkout-session creator) fail CLOSED — a transient
//     blip must NOT silently grant unlimited expensive/paid calls. That's the
//     money leak we're closing.
import { createSupabaseAdmin } from "./admin";

const DEFAULT_PER_IP = 5; // anonymous scans per IP per window
const DEFAULT_WINDOW_MIN = 60;
// Total anonymous scans/day across all IPs. Real traffic is single-digit
// scans/day, so 50 already leaves 5-10x headroom — raising this is a
// deliberate spending decision, not a tuning tweak.
const DEFAULT_GLOBAL_DAILY = 50;

// Buckets that gate an expensive or paid action. On a CONFIGURED-but-erroring
// store these fail CLOSED (deny) instead of open, so a Supabase blip can't be
// used to bypass the throttle on the costly paths. The callers (the Tower deep
// audit route and the Stripe checkout route) don't need to change — we key off
// the bucket name they already pass, so the existing call signature is intact.
const PAID_BUCKETS = new Set(["analyze-tower", "onboard_checkout"]);

export type RateResult = { ok: true } | { ok: false; reason: string };

// Friendly denial message used when a paid-bucket query errors and we fail
// closed. Generic on purpose — we don't leak that the limiter itself hiccuped.
const PAID_FAIL_CLOSED_REASON =
  "We couldn't start that just now — please try again in a moment.";

/**
 * Best-effort client IP from the proxy headers.
 *
 * The LEFTMOST x-forwarded-for entry is fully attacker-controlled (a client can
 * prepend any value), so per-IP throttling keyed on it is trivially bypassed by
 * rotating a spoofed header. On Vercel we prefer, in order:
 *   1. `x-vercel-forwarded-for` — set by Vercel's edge to the real client IP and
 *      not forwardable by the client; the trustworthy source.
 *   2. the RIGHTMOST `x-forwarded-for` hop — the entry appended LAST by the
 *      closest trusted proxy. Still better than the leftmost (client-supplied)
 *      entry when the platform header is absent.
 *   3. `x-real-ip`, then "unknown".
 */
export function clientIp(req: Request): string {
  const vercelIp = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelIp) return vercelIp;

  const xff = req.headers.get("x-forwarded-for") || "";
  const parts = xff
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  // Rightmost (last-appended) hop — the one closest to our edge, not the
  // client-controlled leftmost value.
  const last = parts.length ? parts[parts.length - 1] : "";
  return last || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function checkRateLimit(
  bucket: string,
  ip: string,
  opts: { perIp?: number; windowMin?: number; globalDaily?: number } = {},
): Promise<RateResult> {
  const perIp = opts.perIp ?? DEFAULT_PER_IP;
  const windowMin = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const globalDaily = opts.globalDaily ?? DEFAULT_GLOBAL_DAILY;

  // Is this an expensive/paid path? If so, a CONFIGURED store that errors
  // denies the call rather than waving it through.
  const isPaid = PAID_BUCKETS.has(bucket);
  // What to return when a query errors on a CONFIGURED store.
  const onQueryError: RateResult = isPaid
    ? { ok: false, reason: PAID_FAIL_CLOSED_REASON }
    : { ok: true };

  try {
    const sb = createSupabaseAdmin();
    // UNCONFIGURED → fail OPEN for every bucket (free or paid). Deliberate:
    // the limiter isn't the backstop here, dashboard spend caps are. Wiring up
    // SUPABASE_SERVICE_ROLE_KEY + migration 0006 turns real throttling on.
    if (!sb) return { ok: true };

    const now = Date.now();
    const windowStart = new Date(now - windowMin * 60_000).toISOString();
    const dayStart = new Date(now - 24 * 60 * 60_000).toISOString();

    // Per-IP throttle.
    if (ip && ip !== "unknown") {
      const { count, error } = await sb
        .from("rate_events")
        .select("*", { count: "exact", head: true })
        .eq("bucket", bucket)
        .eq("ip", ip)
        .gte("created_at", windowStart);
      // Configured-but-erroring: paid → deny, free → allow (see header note).
      if (error) return onQueryError;
      if ((count ?? 0) >= perIp) {
        return {
          ok: false,
          reason:
            "You've hit the scan limit for now — try again a little later.",
        };
      }
    }

    // Global daily ceiling (guards against an attacker rotating IPs).
    const { count: globalCount, error: gErr } = await sb
      .from("rate_events")
      .select("*", { count: "exact", head: true })
      .eq("bucket", bucket)
      .gte("created_at", dayStart);
    if (gErr) return onQueryError;
    if ((globalCount ?? 0) >= globalDaily) {
      return {
        ok: false,
        reason:
          "We're at capacity for scans today — please try again tomorrow.",
      };
    }

    // Record this scan. Best-effort — don't block on a failed insert.
    await sb.from("rate_events").insert({ bucket, ip });
    return { ok: true };
  } catch {
    // An UNEXPECTED throw (not a query .error) — e.g. the admin client
    // construction itself failed. Treat like a configured-store query error:
    // paid → deny, free → allow. If the store was actually unconfigured we'd
    // have already returned ok above, so reaching here on a paid bucket means
    // something genuinely broke and we should not grant the paid call.
    return onQueryError;
  }
}
