import { UrlAnalyzeForm } from "@/components/UrlAnalyzeForm";

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
      "Your Google Business Profile URL is all we need to start. No account, no signup.",
  },
  {
    n: "02",
    title: "We scan and analyze",
    body:
      "Recent public reviews are scraped via Nimble, then analyzed for fraud signals by Claude on the Tower pipeline.",
  },
  {
    n: "03",
    title: "Get your report",
    body:
      "An authenticity report with an overall risk score, every flagged review explained in plain English, and a drafted policy-violation request you can copy and submit to Google.",
  },
];

const STACK = [
  "Nimble",
  "Tower",
  "Claude (Anthropic)",
  "Next.js",
  "Vercel",
  "name.com",
];

export default function Home() {
  return (
    <div className="ghost-bg flex flex-1 flex-col">
      <header className="px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-base tracking-tight">
            <span
              aria-hidden
              className="glow-pulse inline-block h-2 w-2 rounded-full bg-[color:var(--accent)]"
            />
            <span>ghost.reviews</span>
          </div>
          <a
            href="https://github.com/asphyxeth-tech/DeveloperWeek2026Hackathon"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
          >
            View on GitHub →
          </a>
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
            ghost.reviews scans your Google Business Profile, surfaces the
            fraud signals, and drafts the policy-violation request you submit
            to Google.
          </p>
          <div className="mt-10 w-full max-w-2xl">
            <UrlAnalyzeForm />
          </div>
        </div>
      </section>

      <section className="border-y border-[color:var(--border)] bg-[color:var(--surface)]/40 px-6 py-16 sm:px-10">
        <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-3">
          <Stat
            top="$53,000"
            label="Maximum FTC penalty per fake review under the Consumer Review Rule, in effect since 2024."
          />
          <Stat
            top="Federal"
            label="Posting or soliciting fake reviews is now a federal violation in the United States."
          />
          <Stat
            top="Transparent"
            label="Every signal we surface comes with a plain-English reason. No black boxes."
          />
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

      <section className="border-t border-[color:var(--border)] bg-[color:var(--surface)]/40 px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            eyebrow="Built right"
            title="Probabilistic signals, never accusations."
          />
          <div className="mt-8 space-y-5 text-base leading-relaxed text-[color:var(--muted-strong)]">
            <p>
              ghost.reviews is a tool for owners who have been targeted by
              policy-violating review activity. It is not a tool for hiding
              honest negative criticism — suppressing legitimate reviews is
              itself an FTC violation and is firmly out of scope.
            </p>
            <p>
              All output is framed as{" "}
              <span className="text-[color:var(--foreground)]">
                likelihood and reasons
              </span>
              , never a definitive verdict. You submit removal requests through
              Google&apos;s official channels — we do not delete reviews,
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
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]"
                />
                ghost.reviews
              </div>
              <div className="mt-1 text-xs text-[color:var(--muted)]">
                Built for the DeveloperWeek New York 2026 Hackathon.
              </div>
            </div>
            <a
              href="https://github.com/asphyxeth-tech/DeveloperWeek2026Hackathon"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
            >
              github.com/asphyxeth-tech/DeveloperWeek2026Hackathon →
            </a>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[color:var(--muted)]">
            <span>Built with:</span>
            {STACK.map((name) => (
              <span key={name} className="text-[color:var(--foreground)]">
                {name}
              </span>
            ))}
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
