"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { signalDef } from "@/lib/signal-defs";

type Business = {
  name: string;
  place_id: string;
  full_address: string;
  total_reviews: number;
  rating: number | null;
  type: string;
  site: string;
};

type FlaggedLite = {
  id: string;
  rating: number;
  posted_at: string;
  reviewer_total_reviews: number;
  text: string;
};

type ScoreResult = {
  place_id: string;
  business_name: string | null;
  score: number;
  anchor_fired: boolean;
  is_candidate: boolean;
  rules_fired: string[];
  reviews_source?: string;
  reviews_pulled?: number;
  reviews_url?: string;
  maps_url?: string;
  flagged_reviews?: FlaggedLite[];
  error?: string;
};

// Hover-able signal pills (anchors highlighted, corroboration muted). The
// native `title` gives a plain-English tooltip on hover — defined once in
// signal-defs.ts and reused on the per-business page.
function SignalPills({ rules }: { rules: string[] }) {
  if (rules.length === 0) {
    return <span className="text-[color:var(--muted)]">no anchors</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {rules.map((r) => {
        const d = signalDef(r);
        return (
          <span
            key={r}
            title={d.desc}
            className={`cursor-help rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              d.tone === "anchor"
                ? "border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
                : "border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--muted-strong)]"
            }`}
          >
            {d.label}
          </span>
        );
      })}
    </div>
  );
}

// Compact date range of the flagged reviews (e.g. "Mar 3 – Mar 14" or "Mar 3").
function formatFlaggedDates(flagged?: FlaggedLite[]): string {
  if (!flagged || flagged.length === 0) return "—";
  const times = flagged
    .map((f) => Date.parse(f.posted_at))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (times.length === 0) return "—";
  const fmt = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const first = fmt(times[0]);
  const last = fmt(times[times.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

type RecurringAuthor = {
  author_id: string;
  author_name: string;
  business_count: number;
  businesses: string[];
};

type Flywheel = {
  total_scans: number;
  candidates: number;
  recurring_authors: RecurringAuthor[];
};

const CONCURRENCY = 4;

export function AdminDashboard({ email }: { email: string }) {
  const [query, setQuery] = useState("auto repair, London, Ontario, Canada");
  const [limit, setLimit] = useState(30);
  const [minReviews, setMinReviews] = useState(20);
  const [depth, setDepth] = useState(75);

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [results, setResults] = useState<Record<string, ScoreResult>>({});
  const [scoring, setScoring] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [flywheel, setFlywheel] = useState<Flywheel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFlywheel = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/scans");
      if (res.ok) setFlywheel(await res.json());
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    loadFlywheel();
  }, [loadFlywheel]);

  async function discover() {
    setError(null);
    setDiscovering(true);
    setBusinesses([]);
    setResults({});
    try {
      const res = await fetch("/api/admin/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit, minReviews }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Discovery failed.");
        return;
      }
      setBusinesses(data.businesses || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
  }

  async function scoreAll() {
    setScoring(true);
    setError(null);
    setResults({});
    setProgress({ done: 0, total: businesses.length });
    let done = 0;
    const queue = [...businesses];

    async function worker() {
      for (;;) {
        const b = queue.shift();
        if (!b) break;
        try {
          const res = await fetch("/api/admin/prospect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              place_id: b.place_id,
              depth,
              business_name: b.name,
              total_reviews: b.total_reviews,
            }),
          });
          const data = await res.json();
          setResults((prev) => ({
            ...prev,
            [b.place_id]: res.ok
              ? { ...data, business_name: b.name }
              : {
                  place_id: b.place_id,
                  business_name: b.name,
                  score: 0,
                  anchor_fired: false,
                  is_candidate: false,
                  rules_fired: [],
                  error: data.error || `HTTP ${res.status}`,
                },
          }));
        } catch (e) {
          setResults((prev) => ({
            ...prev,
            [b.place_id]: {
              place_id: b.place_id,
              business_name: b.name,
              score: 0,
              anchor_fired: false,
              is_candidate: false,
              rules_fired: [],
              error: e instanceof Error ? e.message : "failed",
            },
          }));
        }
        done += 1;
        setProgress({ done, total: businesses.length });
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, businesses.length) }, worker),
    );
    setScoring(false);
    loadFlywheel();
  }

  const scored = Object.values(results).sort((a, b) => b.score - a.score);

  return (
    <div className="ghost-bg min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-baseline justify-between">
          <div className="flex items-center gap-2 font-mono text-base tracking-tight">
            <span className="text-[color:var(--accent)]">/</span>ghostreviews
            <span className="text-[color:var(--accent)]">/</span>
            <span className="ml-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--muted-strong)]">
              admin
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-[color:var(--muted)]">
            <Link
              href="/admin/costs"
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-1.5 font-medium text-[color:var(--muted-strong)] transition hover:border-[color:var(--accent)]/50 hover:text-[color:var(--foreground)]"
            >
              Costs →
            </Link>
            <span>{email}</span>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          {/* Left: the funnel */}
          <div>
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
                Prospect funnel
              </h2>
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                Discover businesses by category + city, then run the v2
                pre-filter. Candidates (score ≥ 50) get verified with Claude
                before any outreach.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2 text-xs text-[color:var(--muted)]">
                  Query (category, city)
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--foreground)]"
                  />
                </label>
                <label className="text-xs text-[color:var(--muted)]">
                  Max businesses
                  <input
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--foreground)]"
                  />
                </label>
                <label className="text-xs text-[color:var(--muted)]">
                  Min reviews
                  <input
                    type="number"
                    value={minReviews}
                    onChange={(e) => setMinReviews(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--foreground)]"
                  />
                </label>
                <label className="text-xs text-[color:var(--muted)]">
                  Scan depth (reviews)
                  <input
                    type="number"
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--foreground)]"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={discover}
                  disabled={discovering || scoring}
                  className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)] disabled:opacity-50"
                >
                  {discovering ? "Discovering…" : "1. Discover"}
                </button>
                {businesses.length > 0 && (
                  <button
                    onClick={scoreAll}
                    disabled={scoring}
                    className="rounded-lg border border-[color:var(--accent)]/40 px-4 py-2 text-sm font-semibold text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/10 disabled:opacity-50"
                  >
                    {scoring
                      ? `Scoring ${progress.done}/${progress.total}…`
                      : `2. Score ${businesses.length}`}
                  </button>
                )}
                <span className="text-xs text-[color:var(--muted)]">
                  {businesses.length > 0 && `${businesses.length} businesses`}
                </span>
              </div>

              {error && (
                <p className="mt-4 rounded-lg border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 px-3 py-2 text-sm text-[color:var(--danger)]">
                  {error}
                </p>
              )}
            </div>

            {/* Results */}
            {scored.length > 0 && (
              <div className="mt-6 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[color:var(--surface-2)] text-xs uppercase tracking-widest text-[color:var(--muted)]">
                      <tr>
                        <th className="px-3 py-3"></th>
                        <th className="px-4 py-3">Score</th>
                        <th className="px-4 py-3">Business</th>
                        <th className="px-4 py-3">Signals</th>
                        <th className="px-4 py-3 text-right">Scanned</th>
                        <th className="px-4 py-3 text-right">Flagged</th>
                        <th className="px-4 py-3">Dates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scored.map((r) => (
                        <tr
                          key={r.place_id}
                          className={`border-t border-[color:var(--border)] ${
                            r.is_candidate ? "bg-[color:var(--accent)]/[0.06]" : ""
                          }`}
                        >
                          {/* Open the per-business "file" */}
                          <td className="px-3 py-3">
                            <Link
                              href={`/admin/business/${encodeURIComponent(r.place_id)}`}
                              title="Open business file"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--muted-strong)] transition hover:border-[color:var(--accent)]/50 hover:text-[color:var(--accent)]"
                            >
                              ↗
                            </Link>
                          </td>
                          <td className="px-4 py-3 font-semibold tabular-nums">
                            <span
                              className={
                                r.is_candidate
                                  ? "text-[color:var(--accent)]"
                                  : "text-[color:var(--muted)]"
                              }
                            >
                              {r.score}
                            </span>
                            {r.is_candidate && (
                              <span className="ml-2 rounded-full bg-[color:var(--accent)]/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--accent)]">
                                lead
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[color:var(--foreground)]">
                            {r.reviews_url ? (
                              <a
                                href={r.reviews_url}
                                target="_blank"
                                rel="noreferrer"
                                title="Open on Google reviews"
                                className="underline decoration-[color:var(--border)] underline-offset-2 transition hover:decoration-[color:var(--accent)] hover:text-[color:var(--accent)]"
                              >
                                {r.business_name}
                              </a>
                            ) : (
                              r.business_name
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-[color:var(--muted-strong)]">
                            {r.error ? (
                              <span className="text-[color:var(--danger)]">
                                ⚠ {r.error}
                              </span>
                            ) : (
                              <SignalPills rules={r.rules_fired} />
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[color:var(--muted-strong)]">
                            {r.error ? "—" : (r.reviews_pulled ?? "—")}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[color:var(--muted-strong)]">
                            {r.error ? "—" : (r.flagged_reviews?.length ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-xs text-[color:var(--muted)]">
                            {r.error ? "—" : formatFlaggedDates(r.flagged_reviews)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-[color:var(--border)] px-4 py-3 text-xs text-[color:var(--muted)]">
                  Leads (≥ 50) — verify each in the public scanner before any
                  outreach. Click ↗ to open a business&apos;s full file. Every
                  scan above is saved to the flywheel.
                </p>
              </div>
            )}
          </div>

          {/* Right: the flywheel */}
          <div>
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
                  Flywheel
                </h2>
                <button
                  onClick={loadFlywheel}
                  className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                >
                  refresh
                </button>
              </div>
              {flywheel ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
                      <div className="text-2xl font-semibold tabular-nums">
                        {flywheel.total_scans}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
                        scans
                      </div>
                    </div>
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
                      <div className="text-2xl font-semibold tabular-nums text-[color:var(--accent)]">
                        {flywheel.candidates}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
                        leads
                      </div>
                    </div>
                  </div>
                  <h3 className="mt-6 text-xs uppercase tracking-widest text-[color:var(--muted)]">
                    Recurring reviewers ({flywheel.recurring_authors.length})
                  </h3>
                  <p className="mt-1 text-[11px] text-[color:var(--muted)]">
                    Accounts flagged across ≥ 2 businesses — likely serial
                    bombers.
                  </p>
                  <ul className="mt-3 space-y-2">
                    {flywheel.recurring_authors.slice(0, 15).map((a) => (
                      <li
                        key={a.author_id}
                        className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-[color:var(--foreground)]">
                          {a.author_name}
                        </span>{" "}
                        <span className="text-[color:var(--accent)]">
                          ×{a.business_count}
                        </span>
                        <div className="mt-0.5 truncate text-[color:var(--muted)]">
                          {a.businesses.join(", ")}
                        </div>
                      </li>
                    ))}
                    {flywheel.recurring_authors.length === 0 && (
                      <li className="text-xs text-[color:var(--muted)]">
                        None yet — they emerge as you scan more businesses.
                      </li>
                    )}
                  </ul>
                </>
              ) : (
                <p className="mt-4 text-sm text-[color:var(--muted)]">
                  Loading… (needs <code>SUPABASE_SERVICE_ROLE_KEY</code>)
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
