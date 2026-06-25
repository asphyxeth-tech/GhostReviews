"use client";

import { useState } from "react";

// The literal consent label. Kept in lockstep with the CONSENT_TEXT stored by
// /api/onboard/[token]/consent — what the customer reads here is exactly what we
// record as their documented, digital consent.
export const CONSENT_LABEL =
  "I authorize Ghost Reviews to act as a Manager on my Google Business Profile and to file policy-violation reports on my behalf. I understand these are requests Google decides on, that I can remove this access at any time, and that Google lets me disassociate within 7 business days.";

// The "Authorize card" step on the onboarding page. Two parts:
//   1. A REQUIRED consent checkbox (legal: Google + FTC require written/digital
//      consent). The button is DISABLED until it's checked.
//   2. On click, we FIRST record the consent (POST /consent), THEN kick off a
//      Stripe-hosted Checkout (setup mode) and redirect the browser to it. No
//      card fields here — Stripe collects the card on its own secure page.
export function AuthorizeCard({ token }: { token: string }) {
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authorize() {
    if (!consented) return; // guard — button is also disabled, but be safe
    setLoading(true);
    setError(null);
    try {
      // Step 1: record the documented consent BEFORE Stripe, so it's on file
      // even if the customer abandons the card step.
      const consentRes = await fetch(`/api/onboard/${token}/consent`, {
        method: "POST",
      });
      if (!consentRes.ok) {
        const data = await consentRes.json().catch(() => ({}));
        setError(
          data.error || "Could not record your authorization. Please try again.",
        );
        setLoading(false);
        return;
      }

      // Step 2: start the Stripe setup checkout and redirect.
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
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--accent)]"
        />
        <span className="text-sm leading-relaxed text-[color:var(--muted-strong)]">
          {CONSENT_LABEL}
        </span>
      </label>

      <button
        onClick={authorize}
        disabled={loading || !consented}
        className="mt-4 rounded-lg bg-[color:var(--accent)] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Redirecting to secure checkout…" : "Authorize card →"}
      </button>
      {!consented && (
        <p className="mt-3 text-xs text-[color:var(--muted)]">
          Please check the box above to continue.
        </p>
      )}
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

// Step 2 of onboarding (rendered on /onboard/[token]/access): the click-by-click
// walkthrough for adding us as a Manager on the owner's Google Business Profile.
// Non-technical-friendly. Includes a one-click COPY for our manager email
// (mirrors the copy UX in BillingPanel) and an "I've sent the invite" button
// that records access_status='invited' on our side.
//
// Honest copy only — we never imply special Google access or guaranteed
// removals; this is Google's own delegation flow and the owner stays in control.
export function AccessWalkthrough({
  token,
  managerEmail,
  initialStatus,
}: {
  token: string;
  managerEmail: string;
  initialStatus: string;
}) {
  const [copied, setCopied] = useState(false);
  // Once we've ACCEPTED the invite (active) or it was revoked, the customer
  // shouldn't see a fresh "send the invite" prompt — reflect the real state.
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(managerEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no-op — they can still select and copy manually */
    }
  }

  async function markInviteSent() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/onboard/${token}/access`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus(data.access_status || "invited");
      } else {
        setError(data.error || "Could not save that. Please try again.");
      }
    } catch {
      setError("Could not save that. Please try again.");
    }
    setBusy(false);
  }

  const steps: { title: string; body?: React.ReactNode }[] = [
    {
      title:
        "Sign in to the Google account that owns your Business Profile",
      body: (
        <>
          Use the same Google login you (or whoever set up your listing) use to
          manage the business on Google.
        </>
      ),
    },
    {
      title: "Open your Business Profile",
      body: (
        <>
          The easiest way: Google-search your business name while signed in — your
          profile&apos;s management box appears at the top. (You can also go to{" "}
          <a
            href="https://google.com/business"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[color:var(--accent)] hover:underline"
          >
            google.com/business
          </a>
          , or open Google Maps and choose &quot;Your business profile&quot;.)
        </>
      ),
    },
    {
      title: 'Open the menu (⋮) and choose "Business Profile settings"',
    },
    {
      title: 'Click "People and access"',
    },
    {
      title: 'Click "Add"',
    },
    {
      title: "Enter our manager email",
      body: (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--foreground)]">
            {managerEmail}
          </code>
          <button
            type="button"
            onClick={copyEmail}
            className="rounded-lg border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-3 py-2 text-xs font-semibold text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20"
          >
            {copied ? "Copied ✓" : "Copy email"}
          </button>
        </div>
      ),
    },
    {
      title: 'Set the access level to "Manager"',
      body: (
        <>
          Manager lets us file reports and respond on your behalf. It does{" "}
          <strong className="text-[color:var(--foreground)]">not</strong> let us
          remove you or transfer ownership — you stay the Owner.
        </>
      ),
    },
    {
      title: 'Click "Invite"',
      body: (
        <>
          Google emails us the invite. We accept it on our end, and then we can
          start filing. We can&apos;t remove any review ourselves — we file
          requests through Google&apos;s official process and Google makes the
          final call.
        </>
      ),
    },
  ];

  const accepted = status === "active";
  const sent = status === "invited";
  const revoked = status === "revoked";

  return (
    <div className="mt-6">
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li
            key={i}
            className="flex gap-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)]/15 text-sm font-semibold text-[color:var(--accent)]">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-semibold text-[color:var(--foreground)]">
                {step.title}
              </p>
              {step.body && (
                <div className="mt-1 text-sm text-[color:var(--muted-strong)]">
                  {step.body}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
        {accepted ? (
          <p className="text-sm font-semibold text-emerald-300">
            ✓ We&apos;ve accepted your invite — we&apos;re all set to file for you.
          </p>
        ) : revoked ? (
          <p className="text-sm text-[color:var(--muted-strong)]">
            Our access has been removed. If that wasn&apos;t intended, re-send the
            invite from the steps above and let us know.
          </p>
        ) : sent ? (
          <div>
            <p className="text-sm font-semibold text-emerald-300">
              ✓ Thanks — we got it.
            </p>
            <p className="mt-2 text-sm text-[color:var(--muted-strong)]">
              We&apos;ll accept the invite on our side shortly and start reviewing
              your flagged reviews. You can remove our access at any time from the
              same &quot;People and access&quot; screen.
            </p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-[color:var(--muted-strong)]">
              Once you&apos;ve clicked &quot;Invite&quot;, let us know so we can
              accept it on our end:
            </p>
            <button
              type="button"
              onClick={markInviteSent}
              disabled={busy}
              className="mt-4 rounded-lg bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : "I've sent the invite ✓"}
            </button>
            {error && (
              <p className="mt-3 text-sm text-[color:var(--danger)]">{error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
