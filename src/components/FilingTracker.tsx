"use client";

import { useState } from "react";

// One flagged review (from the latest scan) we might file for removal.
export type TrackerReview = {
  review_id: string;
  author_name?: string;
  rating?: number | null;
  posted_at?: string | null;
  text_snippet?: string | null;
  review_link?: string | null;
  textless?: boolean;
};

export type Filing = {
  id?: string;
  place_id: string;
  review_id: string;
  business_name?: string | null;
  author_name?: string | null;
  rating?: number | null;
  posted_at?: string | null;
  text_snippet?: string | null;
  review_link?: string | null;
  status: string;
  removal_reason?: string | null;
  notes?: string | null;
  submitted_at?: string | null;
  resolved_at?: string | null;
};

// A success-fee charge tied to a filing (one per filing). Keyed by filing_id in
// the UI so a row can show whether/how it was billed.
export type Charge = {
  id?: string;
  filing_id: string;
  status: string; // pending | succeeded | failed | refunded
  amount_minor?: number | null;
  currency?: string | null;
  last_error?: string | null;
};

const STATUS_OPTIONS = [
  { value: "", label: "Not filed" },
  { value: "drafted", label: "Drafted" },
  { value: "submitted", label: "Submitted" },
  { value: "removed", label: "Removed ✓" },
  { value: "denied", label: "Denied" },
  { value: "reinstated", label: "Reinstated ↩" },
];

const REASONS = [
  "",
  "Fake / no genuine transaction",
  "Off-topic / not about the business",
  "Conflict of interest (competitor)",
  "Harassment or hate speech",
  "Spam",
  "Other policy violation",
];

const STATUS_TONE: Record<string, string> = {
  drafted: "bg-[color:var(--surface-2)] text-[color:var(--muted-strong)] border-[color:var(--border)]",
  submitted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  removed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  denied: "bg-[color:var(--danger)]/15 text-[color:var(--danger)] border-[color:var(--danger)]/30",
  reinstated: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

// Visual tone for the charge badge, by charge status.
const CHARGE_TONE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  succeeded: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  failed: "bg-[color:var(--danger)]/15 text-[color:var(--danger)] border-[color:var(--danger)]/30",
  refunded: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

function fmtCharge(c: Charge): string {
  const amt =
    c.amount_minor != null && c.currency
      ? ` ${c.currency.toUpperCase()} $${(c.amount_minor / 100).toFixed(2)}`
      : "";
  return `${c.status}${amt}`;
}

type Edit = { status: string; removal_reason: string; notes: string };
const EMPTY_EDIT: Edit = { status: "", removal_reason: "", notes: "" };

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function FilingTracker({
  placeId,
  businessName,
  reviews,
  initialFilings,
  initialCharges,
  overallRating,
  totalReviews,
}: {
  placeId: string;
  businessName: string | null;
  reviews: TrackerReview[];
  initialFilings: Filing[];
  // Optional: success-fee charges already on record, keyed off by filing_id.
  // The page may not pass this yet; the UI degrades gracefully without it and
  // fills in charge state as the operator charges from here.
  initialCharges?: Charge[];
  overallRating: number | null;
  totalReviews: number | null;
}) {
  const [filingsByReview, setFilingsByReview] = useState<Record<string, Filing>>(
    () => {
      const init: Record<string, Filing> = {};
      for (const f of initialFilings) init[f.review_id] = f;
      return init;
    },
  );
  // Charges keyed by filing id (a filing has at most one charge).
  const [chargesByFiling, setChargesByFiling] = useState<Record<string, Charge>>(
    () => {
      const init: Record<string, Charge> = {};
      for (const c of initialCharges ?? []) init[c.filing_id] = c;
      return init;
    },
  );
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>(() => {
    const init: Record<string, Edit> = {};
    for (const f of initialFilings) {
      init[f.review_id] = {
        status: f.status || "",
        removal_reason: f.removal_reason || "",
        notes: f.notes || "",
      };
    }
    return init;
  });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setEdit(reviewId: string, patch: Partial<Edit>) {
    setEdits((prev) => ({
      ...prev,
      [reviewId]: { ...(prev[reviewId] ?? EMPTY_EDIT), ...patch },
    }));
  }

  // Merge the latest scan's flagged reviews with any existing filings (so a
  // review that's been removed and dropped out of later scans still shows).
  const rowMap = new Map<string, TrackerReview & { inLatestScan: boolean }>();
  for (const r of reviews) rowMap.set(r.review_id, { ...r, inLatestScan: true });
  for (const f of Object.values(filingsByReview)) {
    if (!rowMap.has(f.review_id)) {
      rowMap.set(f.review_id, {
        review_id: f.review_id,
        author_name: f.author_name ?? "Anonymous",
        rating: f.rating ?? null,
        posted_at: f.posted_at ?? null,
        text_snippet: f.text_snippet ?? "",
        review_link: f.review_link ?? "",
        inLatestScan: false,
      });
    }
  }
  const rows = [...rowMap.values()];

  // Counts + removal impact, from saved filings only (server truth).
  const filings = Object.values(filingsByReview);
  const count = (s: string) => filings.filter((f) => f.status === s).length;
  const removed = filings.filter((f) => f.status === "removed");
  const removedCount = removed.length;
  const sumRemoved = removed.reduce((s, f) => s + (Number(f.rating) || 0), 0);

  let projected: number | null = null;
  let delta: number | null = null;
  if (
    overallRating != null &&
    totalReviews != null &&
    totalReviews > removedCount &&
    removedCount > 0
  ) {
    projected = (overallRating * totalReviews - sumRemoved) / (totalReviews - removedCount);
    delta = projected - overallRating;
  }

  async function save(row: TrackerReview) {
    const e = edits[row.review_id] ?? EMPTY_EDIT;
    if (!e.status) return; // "Not filed" — nothing to persist
    setSavingId(row.review_id);
    setError(null);
    try {
      const res = await fetch("/api/admin/filings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_id: placeId,
          review_id: row.review_id,
          business_name: businessName,
          author_name: row.author_name,
          rating: row.rating,
          posted_at: row.posted_at,
          text_snippet: row.text_snippet,
          review_link: row.review_link,
          status: e.status,
          removal_reason: e.removal_reason,
          notes: e.notes,
        }),
      });
      const data = await res.json();
      if (res.ok && data.filing) {
        setFilingsByReview((prev) => ({ ...prev, [row.review_id]: data.filing }));
        setSavedId(row.review_id);
        setTimeout(
          () => setSavedId((s) => (s === row.review_id ? null : s)),
          1500,
        );
      } else {
        setError(data.error || "Save failed.");
      }
    } catch {
      setError("Save failed.");
    } finally {
      setSavingId(null);
    }
  }

  // Charge the success fee for a CONFIRMED removal. Two-step on purpose: we
  // fetch the operator-facing customer notice in a dry confirm dialog, and only
  // POST { confirm: true } once the operator OKs it. Until Resend is wired this
  // notice is what the operator emails the customer before billing.
  async function chargeFiling(filing: Filing) {
    if (!filing.id) {
      setError("Save the filing first, then charge.");
      return;
    }
    // Pre-charge confirm gate — we never charge silently. The server returns the
    // exact customer notice after; this is the operator's "are you sure".
    const ok = window.confirm(
      `Charge the success fee for this CONFIRMED removal?\n\n` +
        `Review by ${filing.author_name || "Anonymous"}${
          filing.posted_at ? ` (${fmtDate(filing.posted_at)})` : ""
        }.\n\n` +
        `You'll get a pre-charge notice to send the customer after this runs. ` +
        `Only proceed if Google has actually removed the review.`,
    );
    if (!ok) return;
    setError(null);
    setChargingId(filing.id);
    try {
      const res = await fetch(`/api/admin/filings/${filing.id}/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();

      // The route always returns a `customerNotice`; show it so the operator can
      // send it. (TODO server-side: auto-send via Resend.)
      if (data?.customerNotice) {
        window.alert(
          `Pre-charge notice to send the customer:\n\n${data.customerNotice}`,
        );
      }

      if (res.ok && data?.ok) {
        // Succeeded (or already charged) — record the returned charge row.
        if (data.charge) {
          setChargesByFiling((prev) => ({
            ...prev,
            [filing.id as string]: data.charge as Charge,
          }));
        }
      } else {
        // Structured failure (guard / declined / SCA / error). Reflect any
        // returned charge row (status failed + last_error) and show the message.
        if (data?.charge) {
          setChargesByFiling((prev) => ({
            ...prev,
            [filing.id as string]: data.charge as Charge,
          }));
        }
        setError(
          data?.error ||
            (data?.hostedInvoiceUrl
              ? `Customer action needed: ${data.hostedInvoiceUrl}`
              : "Charge failed."),
        );
      }
    } catch {
      setError("Charge request failed.");
    } finally {
      setChargingId(null);
    }
  }

  const inputCls =
    "rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-1 text-xs text-[color:var(--foreground)]";

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
      <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
        Removal filings
      </h2>
      <p className="mt-2 text-xs text-[color:var(--muted)]">
        Track each review we file with Google: drafted → submitted →
        removed/denied. Removal isn&apos;t notified by Google — confirm by
        re-scanning (a filed review that disappears was almost certainly
        removed).
      </p>

      {/* Impact summary */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              <span className="font-semibold tabular-nums">{count("drafted")}</span>{" "}
              <span className="text-[color:var(--muted)]">drafted</span>
            </span>
            <span>
              <span className="font-semibold tabular-nums text-amber-300">
                {count("submitted")}
              </span>{" "}
              <span className="text-[color:var(--muted)]">submitted</span>
            </span>
            <span>
              <span className="font-semibold tabular-nums text-emerald-300">
                {count("removed")}
              </span>{" "}
              <span className="text-[color:var(--muted)]">removed</span>
            </span>
            <span>
              <span className="font-semibold tabular-nums text-[color:var(--danger)]">
                {count("denied")}
              </span>{" "}
              <span className="text-[color:var(--muted)]">denied</span>
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4">
          <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
            Estimated rating lift
          </div>
          {projected != null && delta != null ? (
            <div className="mt-1 text-sm">
              <span className="tabular-nums text-[color:var(--muted-strong)]">
                ★ {overallRating?.toFixed(2)}
              </span>{" "}
              <span className="text-[color:var(--muted)]">→</span>{" "}
              <span className="font-semibold tabular-nums text-emerald-300">
                ★ {projected.toFixed(2)}
              </span>{" "}
              <span className="text-emerald-300">
                (+{delta.toFixed(2)})
              </span>
              <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                from {removedCount} removed review
                {removedCount === 1 ? "" : "s"} — estimate, organic reviews shift
                the real number.
              </div>
            </div>
          ) : (
            <div className="mt-1 text-sm text-[color:var(--muted)]">
              No removals logged yet — the projected lift appears once a filing is
              marked removed.
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 px-3 py-2 text-xs text-[color:var(--danger)]">
          {error}
        </p>
      )}

      {/* Per-review rows */}
      {rows.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => {
            const filing = filingsByReview[row.review_id];
            const e = edits[row.review_id] ?? EMPTY_EDIT;
            // The success-fee charge for this filing (if any). We can only
            // charge a SAVED filing that's confirmed 'removed' and not already
            // charged/refunded.
            const charge = filing?.id ? chargesByFiling[filing.id] : undefined;
            const isRemoved = filing?.status === "removed";
            const alreadyBilled =
              charge?.status === "succeeded" || charge?.status === "refunded";
            const showChargeBtn = isRemoved && filing?.id != null;
            return (
              <li
                key={row.review_id}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums text-[color:var(--danger)]">
                      {row.rating ?? "?"}★
                    </span>
                    <span className="font-medium text-[color:var(--foreground)]">
                      {row.author_name || "Anonymous"}
                    </span>
                    {row.posted_at && (
                      <span className="text-[color:var(--muted)]">
                        · {fmtDate(row.posted_at)}
                      </span>
                    )}
                    {!row.inLatestScan && (
                      <span
                        title="This review wasn't in the latest scan — if it was filed, it may have been removed."
                        className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300"
                      >
                        gone from latest scan
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {filing?.status && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                          STATUS_TONE[filing.status] ?? ""
                        }`}
                      >
                        {filing.status}
                      </span>
                    )}
                    {charge && (
                      <span
                        title={charge.last_error || undefined}
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                          CHARGE_TONE[charge.status] ?? ""
                        }`}
                      >
                        fee: {fmtCharge(charge)}
                      </span>
                    )}
                  </div>
                </div>

                {row.text_snippet ? (
                  <p className="mt-2 text-sm text-[color:var(--muted-strong)]">
                    “{row.text_snippet}”
                  </p>
                ) : (
                  <p className="mt-2 text-sm italic text-[color:var(--muted)]">
                    (no review text)
                  </p>
                )}
                {row.review_link && (
                  <a
                    href={row.review_link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-[color:var(--accent)] hover:underline"
                  >
                    View on Google ↗
                  </a>
                )}

                {/* Filing controls */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={e.status}
                    onChange={(ev) =>
                      setEdit(row.review_id, { status: ev.target.value })
                    }
                    className={inputCls}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={e.removal_reason}
                    onChange={(ev) =>
                      setEdit(row.review_id, { removal_reason: ev.target.value })
                    }
                    className={inputCls}
                    title="Policy basis for removal"
                  >
                    {REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r || "Reason…"}
                      </option>
                    ))}
                  </select>
                  <input
                    value={e.notes}
                    onChange={(ev) =>
                      setEdit(row.review_id, { notes: ev.target.value })
                    }
                    placeholder="Notes"
                    className={`${inputCls} min-w-[8rem] flex-1`}
                  />
                  <button
                    onClick={() => save(row)}
                    disabled={!e.status || savingId === row.review_id}
                    className="rounded-md border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20 disabled:opacity-40"
                  >
                    {savingId === row.review_id
                      ? "Saving…"
                      : savedId === row.review_id
                        ? "Saved ✓"
                        : "Save"}
                  </button>
                </div>

                {/* Success-fee charge — only on a CONFIRMED removal. We charge
                    exactly once per removed review, against the card on file. */}
                {showChargeBtn && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => filing && chargeFiling(filing)}
                      disabled={
                        alreadyBilled ||
                        charge?.status === "pending" ||
                        chargingId === filing?.id
                      }
                      title={
                        alreadyBilled
                          ? "This removal has already been billed."
                          : "Charges the agreed success fee to the client's card on file. Requires the client to have a saved card and active manager access — the server refuses otherwise."
                      }
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-40"
                    >
                      {chargingId === filing?.id
                        ? "Charging…"
                        : charge?.status === "succeeded"
                          ? "Charged ✓"
                          : charge?.status === "refunded"
                            ? "Refunded"
                            : charge?.status === "failed"
                              ? "Retry charge"
                              : "Charge success fee"}
                    </button>
                    {charge?.status === "failed" && charge.last_error && (
                      <span className="text-[11px] text-[color:var(--danger)]">
                        {charge.last_error}
                      </span>
                    )}
                    {!charge && (
                      <span className="text-[11px] text-[color:var(--muted)]">
                        Bills the agreed fee once — client must be billing-ready
                        (card + active access).
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[color:var(--muted)]">
          No flagged reviews on the latest scan to file.
        </p>
      )}
    </div>
  );
}
