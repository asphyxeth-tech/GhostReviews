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

const STATUS_OPTIONS = [
  { value: "", label: "Not filed" },
  { value: "drafted", label: "Drafted" },
  { value: "submitted", label: "Submitted" },
  { value: "removed", label: "Removed ✓" },
  { value: "denied", label: "Denied" },
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
};

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
  overallRating,
  totalReviews,
}: {
  placeId: string;
  businessName: string | null;
  reviews: TrackerReview[];
  initialFilings: Filing[];
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
                  {filing?.status && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                        STATUS_TONE[filing.status] ?? ""
                      }`}
                    >
                      {filing.status}
                    </span>
                  )}
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
