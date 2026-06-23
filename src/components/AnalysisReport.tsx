"use client";

import { useState } from "react";
import type {
  AnalyzeResponse,
  FlaggedReview,
} from "@/lib/analysis-schema";

const RISK_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  low: {
    bg: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    text: "text-emerald-300",
    label: "Low risk",
  },
  medium: {
    bg: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    text: "text-amber-300",
    label: "Medium risk",
  },
  high: {
    bg: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    text: "text-orange-300",
    label: "High risk",
  },
  critical: {
    bg: "bg-red-500/15 text-red-300 border-red-500/30",
    text: "text-red-300",
    label: "Critical risk",
  },
};

export function AnalysisReport({ data }: { data: AnalyzeResponse }) {
  const { mode, business_url, generated_at, reviews_source, reviews_total, report } =
    data;
  const badge = RISK_BADGE[report.risk_level] ?? RISK_BADGE.medium;
  // For anonymous (gated) scans the flagged-review detail is withheld, so the
  // true count comes from flagged_count rather than the (empty) array.
  const flaggedShown = data.gated
    ? (data.flagged_count ?? 0)
    : report.flagged_reviews.length;
  // Any non-mock source (outscraper / nimble) is a live scrape;
  // only "mock" is the bundled demo dataset.
  const isLive = reviews_source !== "mock";
  const sourceLabel = isLive ? "Live Google data" : "Demo dataset";

  return (
    <div className="animate-fade-in-up text-left">
      {mode === "stub" && (
        <div className="mb-8 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-sm text-[color:var(--muted-strong)]">
          <strong className="text-[color:var(--foreground)]">Demo mode.</strong>{" "}
          The Claude analysis step is returning a canned result because no{" "}
          <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> is
          configured in this environment. The same code path runs against
          live Claude analysis when the key is present.
        </div>
      )}

      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-7 sm:p-9">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-baseline gap-4">
            <div className="text-6xl font-semibold tracking-tight tabular-nums sm:text-7xl">
              {report.overall_risk_score}
            </div>
            <div className="text-sm text-[color:var(--muted)]">
              <div>/ 100</div>
              <div className="mt-1 font-mono uppercase tracking-widest">
                risk score
              </div>
            </div>
          </div>
          <span
            className={`inline-flex items-center self-start rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-widest ${badge.bg}`}
          >
            {badge.label}
          </span>
        </div>
        <p className="mt-6 text-base leading-relaxed text-[color:var(--muted-strong)]">
          {report.summary}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[color:var(--muted)]">
          <span>
            Analyzed{" "}
            <span className="text-[color:var(--foreground)]">
              {report.total_reviews_analyzed}
            </span>{" "}
            reviews
          </span>
          <span>
            Flagged{" "}
            <span className="text-[color:var(--foreground)]">
              {flaggedShown}
            </span>
          </span>
          <span className="truncate">
            Source:{" "}
            <span className="text-[color:var(--foreground)]">{business_url}</span>
          </span>
          <span
            className="inline-flex items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--muted-strong)]"
            title={
              isLive
                ? "Reviews pulled live from your public Google profile"
                : "Reviews from the bundled sample dataset"
            }
          >
            {sourceLabel}
          </span>
          <span>
            Generated: {new Date(generated_at).toLocaleString()}
          </span>
        </div>
      </div>

      {isLive && (
        <div className="mt-6 rounded-2xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/[0.06] p-6 sm:p-7">
          <h3 className="text-base font-semibold text-[color:var(--foreground)]">
            This is a free preview
            {typeof reviews_total === "number" &&
            reviews_total > report.total_reviews_analyzed
              ? ` — we scanned your ${report.total_reviews_analyzed} most recent reviews of ${reviews_total.toLocaleString()} total.`
              : ` — we scanned your ${report.total_reviews_analyzed} most recent reviews.`}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted-strong)]">
            Reputation protection is ongoing work. With{" "}
            <span className="font-medium text-[color:var(--foreground)]">
              Ghost Reviews
            </span>{" "}
            you get a{" "}
            <strong className="font-medium text-[color:var(--foreground)]">
              complete audit of every review
            </strong>{" "}
            your business has ever received — a full evidence report you can act
            on — plus{" "}
            <strong className="font-medium text-[color:var(--foreground)]">
              always-on monitoring
            </strong>{" "}
            that scans new reviews as they arrive and alerts you the moment a
            coordinated attack appears.
          </p>
          <a
            href="mailto:onlinedevon88@gmail.com?subject=Ghost%20Reviews%20%E2%80%94%20full%20audit%20%2B%20monitoring&body=I%27d%20like%20the%20complete%20audit%20and%20ongoing%20protection%20for%20my%20business.%20Here%27s%20my%20Google%20Business%20Profile%3A%20"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)]"
          >
            Get the full audit + ongoing protection →
          </a>
        </div>
      )}

      <div className="mt-10">
        <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
          Flagged reviews ({flaggedShown})
        </h3>
        {data.gated ? (
          <LockedFlagged count={flaggedShown} />
        ) : report.flagged_reviews.length === 0 ? (
          <p className="mt-6 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 text-sm text-[color:var(--muted-strong)]">
            No reviews exhibited the fraud signals we look for. Negative
            reviews with specific, falsifiable details belong on Google.
          </p>
        ) : (
          <div className="mt-6 space-y-5">
            {report.flagged_reviews.map((flagged) => (
              <FlaggedReviewCard key={flagged.review_id} flagged={flagged} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Anonymous teaser: we show the count but gate the specifics (which reviews,
 * the reasoning, and the drafted removal requests). Creating a free account
 * unlocks the full report — that's also our lead-capture + consent step.
 */
function LockedFlagged({ count }: { count: number }) {
  if (count === 0) {
    return (
      <p className="mt-6 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 text-sm text-[color:var(--muted-strong)]">
        No reviews exhibited the fraud signals we look for. Negative reviews with
        specific, falsifiable details belong on Google.
      </p>
    );
  }
  return (
    <div className="mt-6 rounded-2xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/[0.06] p-8 text-center">
      <div className="text-3xl" aria-hidden>
        🔒
      </div>
      <h4 className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
        {count} review{count === 1 ? "" : "s"} flagged for removal
      </h4>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[color:var(--muted-strong)]">
        We&apos;ve identified {count} review{count === 1 ? "" : "s"} showing
        strong signals of inauthentic, policy-violating activity — and drafted a
        removal request for each. Create a free account to see exactly which
        reviews, why they&apos;re flagged, and get the ready-to-file removal
        requests.
      </p>
      <a
        href="/login"
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)]"
      >
        See the flagged reviews — free →
      </a>
    </div>
  );
}

function FlaggedReviewCard({ flagged }: { flagged: FlaggedReview }) {
  const [copied, setCopied] = useState(false);
  const badge = RISK_BADGE[flagged.risk_level] ?? RISK_BADGE.medium;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(flagged.removal_request_draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--accent)]/40 sm:p-7">
      <header className="flex flex-wrap items-center gap-3 text-sm">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-widest ${badge.bg}`}
        >
          {badge.label}
        </span>
        <span className="text-[color:var(--foreground)] font-medium">
          {flagged.reviewer_name}
        </span>
        <span className="text-[color:var(--muted)]">
          {"★".repeat(flagged.rating)}
          {"☆".repeat(5 - flagged.rating)}
        </span>
        <span className="text-[color:var(--muted)]">
          {new Date(flagged.posted_at).toLocaleString()}
        </span>
      </header>

      <div className="mt-5">
        <h4 className="font-mono text-xs uppercase tracking-widest text-[color:var(--muted)]">
          Signals detected ({flagged.signals.length})
        </h4>
        <ul className="mt-3 space-y-2 text-sm text-[color:var(--muted-strong)]">
          {flagged.signals.map((signal, idx) => (
            <li key={idx} className="flex gap-3">
              <span
                aria-hidden
                className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[color:var(--accent)]"
              />
              <span>{signal}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        <h4 className="font-mono text-xs uppercase tracking-widest text-[color:var(--muted)]">
          Why this is flagged
        </h4>
        <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted-strong)]">
          {flagged.reasoning}
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-[color:var(--accent)]/25 bg-[color:var(--accent)]/5 p-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-mono text-xs uppercase tracking-widest text-[color:var(--accent)]">
            Drafted removal request
          </h4>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md border border-[color:var(--accent)]/40 px-3 py-1 text-xs font-semibold text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/10"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--muted-strong)]">
          {flagged.removal_request_draft}
        </p>
        <p className="mt-4 text-xs text-[color:var(--muted)]">
          Substitute your real business name where the draft says{" "}
          <code className="font-mono">[BUSINESS NAME]</code>, then submit
          through Google&apos;s policy-violation form on your Business Profile.
        </p>
      </div>
    </article>
  );
}
