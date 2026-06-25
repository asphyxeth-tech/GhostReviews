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
  const { business_url, generated_at, reviews_total, report } = data;
  const badge = RISK_BADGE[report.risk_level] ?? RISK_BADGE.medium;
  // For anonymous (gated) scans the flagged-review detail is withheld, so the
  // true count comes from flagged_count rather than the (empty) array.
  const flaggedShown = data.gated
    ? (data.flagged_count ?? 0)
    : report.flagged_reviews.length;
  // Public scans always run against live, publicly available Google review
  // data — there is no demo/mock dataset served to visitors.
  const sourceLabel = "Live Google data";

  return (
    <div className="animate-fade-in-up text-left">
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
            title="Reviews pulled live from your public Google profile"
          >
            {sourceLabel}
          </span>
          <span>
            Generated: {new Date(generated_at).toLocaleString()}
          </span>
        </div>
      </div>

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
          coordinated attack appears. If you&apos;d like a hand, we can also act
          as a Manager on your Google profile and file the policy-violation
          reports for you.
        </p>
        <a
          href="mailto:devon@ghostreviews.app?subject=Ghost%20Reviews%20%E2%80%94%20request%20my%20full%20audit&body=I%27d%20like%20the%20complete%20audit%20and%20ongoing%20protection%20for%20my%20business.%20Here%27s%20my%20Google%20Business%20Profile%3A%20"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)]"
        >
          Request your full audit →
        </a>
        <p className="mt-4 text-xs leading-relaxed text-[color:var(--muted)]">
          Independent · based in London, ON · you stay in control of your Google
          profile — you can remove our access anytime.
        </p>
      </div>

      <div className="mt-10">
        <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
          Flagged reviews ({flaggedShown})
        </h3>
        {data.gated ? (
          <LockedFlagged count={flaggedShown} />
        ) : report.flagged_reviews.length === 0 ? (
          <>
            <p className="mt-6 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 text-sm text-[color:var(--muted-strong)]">
              No reviews exhibited the fraud signals we look for. Negative
              reviews with specific, falsifiable details belong on Google.
            </p>
            <CleanMonitoringCta />
          </>
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
      <>
        <p className="mt-6 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 text-sm text-[color:var(--muted-strong)]">
          No reviews exhibited the fraud signals we look for. Negative reviews
          with specific, falsifiable details belong on Google.
        </p>
        <CleanMonitoringCta />
      </>
    );
  }
  return (
    <div className="mt-6 rounded-2xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/[0.06] p-8 text-center">
      <div className="text-3xl" aria-hidden>
        🔒
      </div>
      <h4 className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
        {count} review{count === 1 ? "" : "s"} showing strong signals
      </h4>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[color:var(--muted-strong)]">
        We&apos;ve flagged {count} review{count === 1 ? "" : "s"} showing strong
        signals of inauthentic, policy-violating activity — and drafted a removal
        request for each. Create a free account to see exactly which reviews,
        the plain-English reasons, and the ready-to-file removal requests.
      </p>
      <a
        href="/login"
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)]"
      >
        Create a free account to unlock →
      </a>
    </div>
  );
}

/**
 * Soft monitoring CTA shown on the "no signals found" state. A clean scan today
 * is the right moment to offer ongoing watch — framed as protection, never a
 * scare. Captures intent via a prefilled mailto since there's no booking tool.
 */
function CleanMonitoringCta() {
  return (
    <div className="mt-5 rounded-2xl border border-[color:var(--accent)]/25 bg-[color:var(--accent)]/[0.05] p-6 text-center">
      <h4 className="text-base font-semibold text-[color:var(--foreground)]">
        You&apos;re clean today.
      </h4>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[color:var(--muted-strong)]">
        Attacks can start any time. Want us to watch your profile and alert you
        the moment a coordinated attack appears?
      </p>
      <a
        href="mailto:devon@ghostreviews.app?subject=Ghost%20Reviews%20%E2%80%94%20monitor%20my%20profile&body=My%20latest%20scan%20was%20clean.%20I%27d%20like%20ongoing%20monitoring%20so%20I%27m%20alerted%20if%20an%20attack%20starts.%20Here%27s%20my%20Google%20Business%20Profile%3A%20"
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[color:var(--accent)]/40 px-5 py-2.5 text-sm font-semibold text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/10"
      >
        Watch my profile →
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
