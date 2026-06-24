import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

// Shown after the client returns from Stripe-hosted Checkout. The card is saved;
// our webhook flips the client to "active" moments later.
export const dynamic = "force-static";

export default function OnboardDonePage() {
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
            You&apos;re all set — thank you.
          </h1>
          <p className="mt-3 leading-relaxed text-[color:var(--muted-strong)]">
            Your card is securely on file with Stripe. We&apos;ll start working on
            your flagged reviews right away, and{" "}
            <strong className="text-[color:var(--foreground)]">
              you&apos;ll only ever be charged when a review is actually removed
            </strong>{" "}
            — which you can confirm yourself on your Google profile. Nothing was
            charged today.
          </p>
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
