// Server-only Stripe client. Reads STRIPE_SECRET_KEY (use a TEST key — sk_test_…
// — until the whole flow is validated, then swap to live). Returns null when
// unconfigured so routes can degrade gracefully instead of throwing.
//
// NEVER import this into a client component — the secret key must never reach the
// browser. The card-collection UI is Stripe-HOSTED (Checkout), so we never touch
// card data and don't need a client-side publishable key.
import Stripe from "stripe";

// Pin the Stripe API version explicitly so a future SDK/library bump can't
// silently change request/response shapes underneath us. This string matches
// the version the installed `stripe` package's TypeScript types are generated
// against (its `LatestApiVersion`), so it type-checks cleanly. If you upgrade
// the `stripe` package, update this to that release's pinned version.
const STRIPE_API_VERSION = "2026-05-27.dahlia" as const;

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.trim()) return null;
  cached = new Stripe(key.trim(), { apiVersion: STRIPE_API_VERSION });
  return cached;
}

/** Webhook signing secret (whsec_…) for verifying Stripe webhook payloads. */
export function getWebhookSecret(): string | null {
  const s = process.env.STRIPE_WEBHOOK_SECRET;
  return s && s.trim() ? s.trim() : null;
}
