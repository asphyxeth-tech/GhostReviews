import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseAdmin } from "@/lib/admin";
import { Wordmark } from "@/components/Wordmark";
import { AuthorizeCard } from "@/components/AuthorizeCard";

// Customer-facing onboarding page, reached via a secret link the operator sends.
// Shows the agreement + a Stripe-hosted "authorize card" step. Token-gated (the
// random token IS the access control); read server-side via the service role.
export const dynamic = "force-dynamic";

type Client = {
  id: string;
  business_name: string | null;
  fee_per_removal: number;
  currency: string;
  status: string;
  onboarding_token_expires_at: string | null;
};

function money(amount: number, currency: string): string {
  return `${currency.toUpperCase()} $${amount.toFixed(0)}`;
}

export default async function OnboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = createSupabaseAdmin();
  if (!sb) notFound();

  const { data } = await sb
    .from("clients")
    .select(
      "id, business_name, fee_per_removal, currency, status, onboarding_token_expires_at",
    )
    .eq("onboarding_token", token)
    .maybeSingle();
  const client = data as Client | null;
  if (!client) notFound();

  // An already-active client (card on file) sees the all-set state, never the
  // agreement — checked before expiry so a returning customer with an old-but-
  // completed link still sees success rather than an "expired" wall.
  const isActive = client.status === "active";

  // Onboarding links don't live forever. An expired link can't start a Stripe
  // session or record consent, so show a clear "expired — contact us" message
  // instead of the agreement.
  const isExpired =
    !isActive &&
    !!client.onboarding_token_expires_at &&
    new Date(client.onboarding_token_expires_at).getTime() < Date.now();

  const fee = money(client.fee_per_removal, client.currency);

  return (
    <div className="ghost-bg flex flex-1 flex-col">
      <header className="px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="flex items-center gap-2 font-mono text-base">
            <Wordmark />
          </span>
        </div>
      </header>

      <main className="px-6 py-8 sm:px-10">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            Set up review removal
            {client.business_name ? ` for ${client.business_name}` : ""}
          </h1>

          {isActive ? (
            <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-6 text-sm text-[color:var(--muted-strong)]">
              <p className="text-base font-semibold text-emerald-300">
                ✓ You&apos;re all set.
              </p>
              <p className="mt-2">
                Your card is securely on file. We&apos;ll get to work, and you&apos;ll
                only ever be charged when we actually get a fake review removed —
                which you can verify yourself on your Google profile. You can
                contact us any time to make changes.
              </p>
              <p className="mt-4">
                <Link
                  href={`/onboard/${token}/access`}
                  className="font-semibold text-emerald-300 hover:underline"
                >
                  Next: give us access so we can file for you →
                </Link>
              </p>
            </div>
          ) : isExpired ? (
            <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-6 text-sm text-[color:var(--muted-strong)]">
              <p className="text-base font-semibold text-amber-300">
                This link has expired.
              </p>
              <p className="mt-2">
                For your security, onboarding links expire after a couple of
                weeks. Email us and we&apos;ll send you a fresh one right away:{" "}
                <a
                  href="mailto:devon@ghostreviews.app"
                  className="text-[color:var(--accent)] hover:underline"
                >
                  devon@ghostreviews.app
                </a>
                .
              </p>
            </div>
          ) : (
            <>
              <p className="mt-3 leading-relaxed text-[color:var(--muted-strong)]">
                Here&apos;s exactly what you&apos;re agreeing to — no surprises:
              </p>

              <div className="mt-6 space-y-4">
                <Term
                  title={`You only pay for results — ${fee} per fake review we actually get removed`}
                >
                  If nothing comes off, you owe nothing. You&apos;ll see each
                  removal on your own Google profile before we charge anything.
                </Term>
                <Term title="We never see your card number">
                  Your card is handled entirely by Stripe (the payment processor
                  behind millions of businesses). We can charge the agreed amount
                  on success — we can&apos;t see or store your card details.
                </Term>
                <Term title="You stay in full control">
                  You can remove our access to your Google profile in a few
                  clicks at any time, and you can ask us to stop at any time. No
                  contract, no lock-in.
                </Term>
                <Term title="We only target fake / policy-violating reviews">
                  We never touch legitimate reviews, even negative ones. We file
                  reports through Google&apos;s official process; Google makes the
                  final call, and we can&apos;t guarantee any specific removal.
                </Term>
              </div>

              <div className="mt-8 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
                <h2 className="text-base font-semibold text-[color:var(--foreground)]">
                  Authorize your card to get started
                </h2>
                <p className="mt-2 text-sm text-[color:var(--muted-strong)]">
                  Saving a card now lets us bill the success fee automatically{" "}
                  <em>only</em> when a review is removed. You are not charged
                  anything today.
                </p>
                <div className="mt-5">
                  <AuthorizeCard token={token} />
                </div>
              </div>

              <p className="mt-6 text-xs text-[color:var(--muted)]">
                Questions before you authorize? Email{" "}
                <a
                  href="mailto:devon@ghostreviews.app"
                  className="text-[color:var(--accent)] hover:underline"
                >
                  devon@ghostreviews.app
                </a>
                . By authorizing, you agree to our{" "}
                <a href="/terms" className="text-[color:var(--accent)] hover:underline">
                  Terms
                </a>{" "}
                and{" "}
                <a href="/privacy" className="text-[color:var(--accent)] hover:underline">
                  Privacy Policy
                </a>
                .
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Term({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="flex gap-3">
        <span className="mt-0.5 text-[color:var(--accent)]" aria-hidden>
          ✓
        </span>
        <div>
          <p className="text-sm font-semibold text-[color:var(--foreground)]">
            {title}
          </p>
          <p className="mt-1 text-sm text-[color:var(--muted-strong)]">{children}</p>
        </div>
      </div>
    </div>
  );
}
