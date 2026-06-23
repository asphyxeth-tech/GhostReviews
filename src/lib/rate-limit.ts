// Lightweight rate limiting for the public scan endpoints, backed by the
// existing Supabase (no new infra). Counts recent rows per IP and globally in a
// `rate_events` table via the service role.
//
// Fails OPEN on any error or when unconfigured (no service key, table missing),
// so a scan is NEVER blocked by a limiter problem — protection simply kicks in
// once migration 0006 is applied and SUPABASE_SERVICE_ROLE_KEY is set.
import { createSupabaseAdmin } from "./admin";

const DEFAULT_PER_IP = 5; // anonymous scans per IP per window
const DEFAULT_WINDOW_MIN = 60;
const DEFAULT_GLOBAL_DAILY = 200; // total anonymous scans/day across all IPs

export type RateResult = { ok: true } | { ok: false; reason: string };

/** Best-effort client IP from Vercel's forwarding headers. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

export async function checkRateLimit(
  bucket: string,
  ip: string,
  opts: { perIp?: number; windowMin?: number; globalDaily?: number } = {},
): Promise<RateResult> {
  const perIp = opts.perIp ?? DEFAULT_PER_IP;
  const windowMin = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const globalDaily = opts.globalDaily ?? DEFAULT_GLOBAL_DAILY;

  try {
    const sb = createSupabaseAdmin();
    if (!sb) return { ok: true }; // not configured → fail open

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
      if (error) return { ok: true }; // table missing / error → fail open
      if ((count ?? 0) >= perIp) {
        return {
          ok: false,
          reason:
            "You've hit the free-scan limit for now. Create a free account for unlimited scans, or try again a little later.",
        };
      }
    }

    // Global daily ceiling (guards against an attacker rotating IPs).
    const { count: globalCount, error: gErr } = await sb
      .from("rate_events")
      .select("*", { count: "exact", head: true })
      .eq("bucket", bucket)
      .gte("created_at", dayStart);
    if (gErr) return { ok: true };
    if ((globalCount ?? 0) >= globalDaily) {
      return {
        ok: false,
        reason:
          "We're at capacity for free scans today. Create a free account, or try again tomorrow.",
      };
    }

    // Record this scan. Best-effort — don't block on a failed insert.
    await sb.from("rate_events").insert({ bucket, ip });
    return { ok: true };
  } catch {
    return { ok: true }; // never block a scan on a limiter failure
  }
}
