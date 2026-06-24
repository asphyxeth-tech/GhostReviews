"use client";

import { useState } from "react";

// The "Authorize card" button on the onboarding page. Kicks off a Stripe-hosted
// Checkout (setup mode) and redirects the browser to it. No card fields here —
// Stripe collects the card on its own secure page.
export function AuthorizeCard({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authorize() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/onboard/${token}/checkout`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return; // redirecting
      }
      setError(data.error || "Could not start the secure checkout. Please try again.");
    } catch {
      setError("Could not start the secure checkout. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div>
      <button
        onClick={authorize}
        disabled={loading}
        className="rounded-lg bg-[color:var(--accent)] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)] disabled:opacity-60"
      >
        {loading ? "Redirecting to secure checkout…" : "Authorize card →"}
      </button>
      {error && (
        <p className="mt-3 text-sm text-[color:var(--danger)]">{error}</p>
      )}
      <p className="mt-3 text-xs text-[color:var(--muted)]">
        🔒 Secured by Stripe. We never see your card number, and you won&apos;t be
        charged anything now.
      </p>
    </div>
  );
}
