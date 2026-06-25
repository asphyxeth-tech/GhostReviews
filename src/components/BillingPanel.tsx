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
  // Manager-access state (separate from card-on-file): none | invited | active | revoked
  access_status: string | null;
  access_granted_at: string | null;
  access_revoked_at: string | null;
  // Documented consent proof.
  consent_at: string | null;
  consent_version: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

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

  // Admin records what happened on Google's side: we accepted the Manager invite
  // (→ active) or access was removed (→ revoked). PATCHes the clients route.
  async function setAccess(action: "accept_access" | "revoke_access") {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: client.id, action }),
      });
      const data = await res.json();
      if (res.ok) {
        setClient(data.client ?? client);
      } else {
        setError(data.error || "Could not update access status.");
      }
    } catch {
      setError("Could not update access status.");
    }
    setBusy(false);
  }

  const inputCls =
    "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--foreground)]";

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
      <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
        Billing &amp; access
      </h2>

      {loading ? (
        <p className="mt-3 text-sm text-[color:var(--muted)]">Loading…</p>
      ) : client ? (
        (() => {
          const cardOnFile = client.status === "active";
          const access = client.access_status || "none";
          const accessActive = access === "active";
          const consentCaptured = !!client.consent_at;
          const readyToFile = cardOnFile && accessActive && consentCaptured;
          return (
            <div className="mt-3 space-y-4">
              {/* Three SEPARATE readiness signals — card, access, consent are
                  distinct prerequisites and must not be conflated. */}
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    cardOnFile
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  }`}
                >
                  {cardOnFile ? "✓ Card on file" : "Card: awaiting authorization"}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    accessActive
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : access === "revoked"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  }`}
                >
                  Manager access: {access}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    consentCaptured
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  }`}
                >
                  {consentCaptured
                    ? `✓ Consent captured${
                        fmtDate(client.consent_at)
                          ? ` ${fmtDate(client.consent_at)}`
                          : ""
                      }`
                    : "Consent: not yet captured"}
                </span>
              </div>

              {/* The bottom line: only file when all three are true. */}
              <div
                className={`rounded-xl border p-3 text-sm ${
                  readyToFile
                    ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300"
                    : "border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--muted-strong)]"
                }`}
              >
                {readyToFile
                  ? "✓ Ready to file — card on file, Manager access active, and consent on record."
                  : "Not ready to file yet. A client is only ready when the card is on file AND Manager access is active AND consent is captured."}
              </div>

              <p className="text-sm text-[color:var(--muted-strong)]">
                {client.currency.toUpperCase()} $
                {client.fee_per_removal.toFixed(0)} per review removed. Charged
                automatically when you mark a filing &quot;removed&quot; (Phase B).
                {client.consent_version
                  ? ` Consent ${client.consent_version}.`
                  : ""}
              </p>

              {/* Admin records what happened on Google's side. */}
              <div className="flex flex-wrap gap-2">
                {!accessActive && (
                  <button
                    onClick={() => setAccess("accept_access")}
                    disabled={busy}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {busy ? "Saving…" : "Confirm we accepted the manager invite"}
                  </button>
                )}
                {access !== "revoked" && (
                  <button
                    onClick={() => setAccess("revoke_access")}
                    disabled={busy}
                    className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    Mark access revoked
                  </button>
                )}
              </div>

              {/* The onboarding link to (re)send — useful in any pre-ready state. */}
              {onboardUrl && (
                <div>
                  <p className="text-xs text-[color:var(--muted)]">
                    Secure onboarding link to send them:
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      readOnly
                      value={onboardUrl}
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
              )}
            </div>
          );
        })()
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
