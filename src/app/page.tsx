import Link from "next/link";
import { UrlAnalyzeForm } from "@/components/UrlAnalyzeForm";
import { Wordmark } from "@/components/Wordmark";

const SIGNALS = [
  {
    title: "Timing clusters",
    body:
      "Bursts of negative reviews in a suspiciously short window — a hallmark of coordinated attacks.",
  },
  {
    title: "Reviewer red flags",
    body:
      "Single-review accounts with no history of legitimate activity across Google.",
  },
  {
    title: "Language patterns",
    body:
      "Near-identical or templated phrasing across reviews supposedly written by different people.",
  },
  {
    title: "No evidence of a visit",
    body:
      "Reviews that describe nothing specific — no products, no staff names, no genuine details.",
  },
  {
    title: "Rating anomalies",
    body:
      "Sudden 1-star clusters that break sharply from a healthy long-term baseline.",
  },
  {
    title: "Vague complaints",
    body:
      "Generic negativity with no falsifiable specifics. Real upset customers describe what actually happened.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Paste your URL",
    body:
      "Your Google Business Profile URL is all we need to start. The free scan runs instantly — no payment required.",
  },
  {
    n: "02",
    title: "We scan and analyze",
    body:
      "We pull your recent public reviews and run them through a six-signal forensic analysis for evidence of coordinated, policy-violating activity.",
  },
  {
    n: "03",
    title: "Get your report",
    body:
      "Your free scan shows an overall risk score and how many reviews we flagged. Create a free account to see exactly which reviews we flagged, the plain-English reasons, and the drafted policy-violation request — yours to submit, or we'll file it for you.",
  },
];

// The done-for-you concierge — the actual service (you add us as a Manager and
// we file the removals for you, on a success-fee basis).
const CONCIERGE = [
  {
    title: "Official delegation",
    body:
      "You add us as a Manager through Google's own system — the same way you'd add an employee. No passwords shared, nothing unofficial.",
  },
  {
    title: "You stay in control",
    body:
      "See every review we flag, and remove our access in a few clicks at any time. We act only with your written consent.",
  },
  {
    title: "Pay on results",
    body:
      "We file each policy-violation report and track it through to Google's decision. You only pay when a review is actually removed.",
  },
];

// The dual-market legal/credibility band. Every claim here was verified against
// a primary source (eCFR + Federal Register for the US rule; the Competition
// Bureau for Canada; Google's content policy). We deliberately print NO penalty
// figure: the US per-violation amount is inflation-adjusted (unverified this
// pass) and Canada's is a "greater of" floor, not a simple cap — so both are
// stated qualitatively to stay accurate.
const STATS = [
  {
    top: "Federal law",
    label:
      "In the U.S., fake reviews are illegal under the FTC's Rule on the Use of Consumer Reviews and Testimonials (16 CFR Part 465, in effect since October 2024) — including textless ratings from people who never set foot in your business.",
  },
  {
    top: "Banned in Canada too",
    label:
      "Canada's Competition Bureau treats 'astroturfing' — fake reviews disguised as real customers — as a deceptive marketing practice under the Competition Act, with multi-million-dollar penalties on the table.",
  },
  {
    top: "Against Google's rules",
    label:
      "Reviews that aren't based on a genuine experience, go off-topic, or come from competitors and conflicts of interest violate Google's Maps content policy worldwide and are eligible for removal.",
  },
];

export default function Home() {
  return (
    <div className="ghost-bg flex flex-1 flex-col">
      <header className="px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-base tracking-tight">
            <Wordmark />
          </div>
          <div className="flex items-center gap-5">
            <a
              href="/login"
              className="text-xs text-[color:var(--muted)]/70 transition hover:text-[color:var(--muted-strong)]"
            >
              Sign in
            </a>
            <a
              href="mailto:devon@ghostreviews.app?subject=Ghost Reviews"
              className="text-sm text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
            >
              Contact →
            </a>
          </div>
        </div>
      </header>

      <section className="px-6 pt-16 pb-24 sm:px-10 sm:pt-24 sm:pb-32">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-1.5 text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
            For the businesses being attacked
          </span>
          <h1 className="mt-7 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            See the ghosts
            <br />
            in your reviews.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-[color:var(--muted-strong)] sm:text-xl">
            Coordinated review-bombing attacks tank local businesses every day.
            Scan your Google Business Profile free in seconds — create a free
            account to see exactly which reviews we flagged and the drafted
            removal requests. When you&apos;re ready, we&apos;ll file them with
            Google for you, and you only pay when a review is actually removed.
          </p>
          <div className="mt-10 w-full max-w-2xl">
            <UrlAnalyzeForm />
          </div>
        </div>
      </section>

      <section className="border-y border-[color:var(--border)] bg-[color:var(--surface)]/40 px-6 py-16 sm:px-10">
        <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-3">
          {STATS.map((s) => (
            <Stat key={s.top} top={s.top} label={s.label} />
          ))}
        </div>
      </section>

      <section className="px-6 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            eyebrow="How it works"
            title="Three steps from URL to evidence report."
          />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6"
              >
                <div className="font-mono text-sm text-[color:var(--accent)]">
                  {s.n}
                </div>
                <h3 className="mt-3 text-xl font-semibold">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted-strong)]">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[color:var(--border)] px-6 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            eyebrow="What we look for"
            title="Six fraud signals, every one explained."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SIGNALS.map((s) => (
              <div
                key={s.title}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/40 p-5"
              >
                <h3 className="text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted-strong)]">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[color:var(--border)] px-6 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            eyebrow="Done for you"
            title="Or hand the whole thing to us."
          />
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-[color:var(--muted-strong)]">
            Found a coordinated attack? You don&apos;t have to fight Google&apos;s
            removal process alone. We file the policy-violation reports for you
            and track each one through to a decision — as an official, fully
            reversible Manager on your Google Business Profile.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {CONCIERGE.map((c) => (
              <div
                key={c.title}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/40 p-5"
              >
                <h3 className="text-base font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted-strong)]">
                  {c.body}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-2xl text-sm leading-relaxed text-[color:var(--muted)]">
            Ghost Reviews is run by Devon, an independent operator based in
            London, Ontario — a real person you can email, not a faceless
            platform.
          </p>
        </div>
      </section>

      <section className="border-t border-[color:var(--border)] bg-[color:var(--surface)]/40 px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            eyebrow="Built right"
            title="Probabilistic signals, never accusations."
          />
          <div className="mt-8 space-y-5 text-base leading-relaxed text-[color:var(--muted-strong)]">
            <p>
              Ghost Reviews is a tool for owners who have been targeted by
              policy-violating review activity. It is not a tool for hiding
              honest negative criticism — suppressing legitimate reviews is
              itself unlawful review manipulation under the same
              consumer-protection rules, and is firmly out of scope.
            </p>
            <p>
              All output is framed as{" "}
              <span className="text-[color:var(--foreground)]">
                likelihood and reasons
              </span>
              , never a definitive verdict. Removal requests go through
              Google&apos;s official channels — filed by you, or by us as a
              Manager you&apos;ve authorized in writing. We never delete reviews,
              automate mass-flagging, or attempt to game Google&apos;s systems.
            </p>
            <p>We analyze only public review content. No private data is touched.</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--border)] px-6 py-12 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-start gap-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 font-mono text-sm">
                <Wordmark size="sm" />
              </div>
              <div className="mt-1 text-xs text-[color:var(--muted)]">
                Independent fraud-signal analysis for local businesses.
              </div>
              <div className="mt-1 text-xs text-[color:var(--muted)]">
                Ghost Reviews · Suite 1022, 1737 Richmond Street Unit #9, London,
                ON N5X 3Y2, Canada
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[color:var(--muted)]">
              <Link
                href="/privacy"
                className="transition hover:text-[color:var(--foreground)]"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="transition hover:text-[color:var(--foreground)]"
              >
                Terms
              </Link>
              <a
                href="mailto:devon@ghostreviews.app?subject=Ghost Reviews"
                className="transition hover:text-[color:var(--foreground)]"
              >
                Get in touch →
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Stat({ top, label }: { top: string; label: string }) {
  return (
    <div>
      <div className="text-4xl font-semibold tracking-tight text-[color:var(--foreground)] sm:text-5xl">
        {top}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted-strong)]">
        {label}
      </p>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="max-w-2xl">
      <div className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}
