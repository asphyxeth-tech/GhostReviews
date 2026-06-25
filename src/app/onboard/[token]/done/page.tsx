import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

// Shown after the client returns from Stripe-hosted Checkout. The card is saved;
// our webhook flips the client to "active" moments later. From here we point
// them to STEP 2 — granting us Manager access on their Google profile, which is
// what actually lets us file on their behalf.
export const dynamic = "force-static";

export default async function OnboardDonePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="ghost-bg flex flex-1 flex-col">
      <header className="px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-2xl items-center">
          <span className="flex items-center gap-2 font-mono text-base">
            <Wordmark />
          </span>
        </div>
      </header>
      <main className="px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <div className="text-4xl" aria-hidden>
            ✅
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            Card saved — one quick step left.
          </h1>
          <p className="mt-3 leading-relaxed text-[color:var(--muted-strong)]">
            Your card is securely on file with Stripe, and{" "}
            <strong className="text-[color:var(--foreground)]">
              you&apos;ll only ever be charged when a review is actually removed
            </strong>{" "}
            — which you can confirm yourself on your Google profile. Nothing was
            charged today.
          </p>

          {/* Step 2 — granting Manager access is what actually lets us file. */}
          <div className="mt-8 rounded-2xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/[0.06] p-6 text-left">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Step 2 of 2
            </p>
            <h2 className="mt-2 text-base font-semibold text-[color:var(--foreground)]">
              Give us access so we can file for you
            </h2>
            <p className="mt-2 text-sm text-[color:var(--muted-strong)]">
              Add us as a Manager on your Google Business Profile — Google&apos;s
              own, official way to let us help. It takes about a minute, and you
              can remove our access any time.
            </p>
            <Link
              href={`/onboard/${token}/access`}
              className="mt-4 inline-block rounded-lg bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)]"
            >
              Set up access →
            </Link>
          </div>

          <p className="mt-6 text-sm text-[color:var(--muted)]">
            Questions any time:{" "}
            <a
              href="mailto:devon@ghostreviews.app"
              className="text-[color:var(--accent)] hover:underline"
            >
              devon@ghostreviews.app
            </a>
          </p>
          <Link
            href="/"
            className="mt-8 inline-block text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            ← ghost.reviews
          </Link>
        </div>
      </main>
    </div>
  );
}
