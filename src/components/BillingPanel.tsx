"use client";

import { useCallback, useEffect, useState } from "react";

type Client = {
  id: string;
  business_name: string | null;
  contact_email: string | null;
  fee_per_removal: number;
  currency: string;
  status: string;
  stripe_payment_method_id: string | null;
};

// Admin-side billing panel on a business file: create the success-fee client +
// a secret onboarding link to send them, and watch the card-on-file status flip
// to active once they authorize.
export function BillingPanel({
  placeId,
  businessName,
}: {
  placeId: string;
  businessName: string | null;
}) {
  const [client, setClient] = useState<Client | null>(null);
  const [onboardUrl, setOnboardUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fee, setFee] = useState("100");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/clients?place_id=${encodeURIComponent(placeId)}`,
      );
      const data = await res.json();
      if (res.ok) {
        setClient(data.client ?? null);
        setOnboardUrl(data.onboarding_url ?? null);
      }
    } catch {
      /* best-effort */
    }
    setLoading(false);
  }, [placeId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function createClient() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_id: placeId,
          business_name: businessName,
          contact_email: email.trim() || null,
          fee_per_removal: Number(fee) || 100,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setClient(data.client ?? null);
        setOnboardUrl(data.onboarding_url ?? null);
      } else {
        setError(data.error || "Could not create the client.");
      }
    } catch {
      setError("Could not create the client.");
    }
    setBusy(false);
  }

  async function copyLink() {
    if (!onboardUrl) return;
    try {
      await navigator.clipboard.writeText(onboardUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no-op */
    }
  }

  const inputCls =
    "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--foreground)]";

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
      <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
        Billing (card on file)
      </h2>

      {loading ? (
        <p className="mt-3 text-sm text-[color:var(--muted)]">Loading…</p>
      ) : client && client.status === "active" ? (
        <div className="mt-3">
          <p className="text-sm">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">
              ✓ Card on file
            </span>
          </p>
          <p className="mt-3 text-sm text-[color:var(--muted-strong)]">
            {client.currency.toUpperCase()} ${client.fee_per_removal.toFixed(0)} per
            review removed. Charged automatically when you mark a filing
            &quot;removed&quot; (Phase B).
          </p>
        </div>
      ) : client ? (
        <div className="mt-3">
          <p className="text-sm text-[color:var(--muted-strong)]">
            Client created at{" "}
            {client.currency.toUpperCase()} ${client.fee_per_removal.toFixed(0)}/removal
            — <span className="text-amber-300">waiting for card authorization.</span>{" "}
            Send them this secure link:
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={onboardUrl ?? ""}
              className={`${inputCls} min-w-[14rem] flex-1`}
            />
            <button
              onClick={copyLink}
              className="rounded-lg border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-3 py-2 text-xs font-semibold text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20"
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-[color:var(--muted-strong)]">
            Set up success-fee billing for this business. Generates a secure
            onboarding link to send them — they authorize a card, charged only on
            a removal.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[color:var(--muted)]">
              Fee per removal (CAD)
              <input
                type="number"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className={`mt-1 w-full ${inputCls}`}
              />
            </label>
            <label className="text-xs text-[color:var(--muted)]">
              Client email (optional)
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@business.com"
                className={`mt-1 w-full ${inputCls}`}
              />
            </label>
          </div>
          <button
            onClick={createClient}
            disabled={busy}
            className="mt-4 rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)] disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create onboarding link"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-[color:var(--danger)]">{error}</p>
      )}
    </div>
  );
}
