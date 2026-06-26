import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseAdmin } from "@/lib/admin";
import { getManagerEmail } from "@/lib/manager";
import { Wordmark } from "@/components/Wordmark";
// AccessWalkthrough lives in the AuthorizeCard module (both are the customer-
// facing onboarding client components) so we don't add a new component file.
import { AccessWalkthrough } from "@/components/AuthorizeCard";

// Step 2 of onboarding: walk a non-technical owner through adding us as a
// Manager on their Google Business Profile. Token-gated (the random token IS the
// access control), read server-side via the service role. Reached from the
// /done page ("give us access so we can file for you").
export const dynamic = "force-dynamic";

type Client = {
  id: string;
  business_name: string | null;
  access_status: string;
  onboarding_token_expires_at: string | null;
};

export default async function OnboardAccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = createSupabaseAdmin();
  if (!sb) notFound();

  const { data } = await sb
    .from("clients")
    .select("id, business_name, access_status, onboarding_token_expires_at")
    .eq("onboarding_token", token)
    .maybeSingle();
  const client = data as Client | null;
  if (!client) notFound();

  // Expired links can't record an "invite sent", so show a contact message.
  const isExpired =
    !!client.onboarding_token_expires_at &&
    // eslint-disable-next-line react-hooks/purity -- server component renders once per request; comparing token expiry to the current time is intentional
    new Date(client.onboarding_token_expires_at).getTime() < Date.now();

  const managerEmail = getManagerEmail();

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
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
            Step 2 of 2
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            Give us access so we can file for you
            {client.business_name ? ` — ${client.business_name}` : ""}
          </h1>

          {isExpired ? (
            <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-6 text-sm text-[color:var(--muted-strong)]">
              <p className="text-base font-semibold text-amber-300">
                This link has expired.
              </p>
              <p className="mt-2">
                For your security, onboarding links expire after a couple of
                weeks. Email us and we&apos;ll send you a fresh one:{" "}
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
                To file removal reports on your behalf, Google needs you to add us
                as a <strong className="text-[color:var(--foreground)]">Manager</strong>{" "}
                on your Business Profile. This is Google&apos;s own, official way to
                let someone help you — you stay the owner, you see everything, and{" "}
                <strong className="text-[color:var(--foreground)]">
                  you can remove our access in a few clicks at any time
                </strong>
                . Here&apos;s exactly where to click. It takes about a minute.
              </p>

              <AccessWalkthrough
                token={token}
                managerEmail={managerEmail}
                initialStatus={client.access_status}
              />

              <p className="mt-8 text-xs text-[color:var(--muted)]">
                Stuck on any step? Email us a screenshot and we&apos;ll point you to
                the right button:{" "}
                <a
                  href="mailto:devon@ghostreviews.app"
                  className="text-[color:var(--accent)] hover:underline"
                >
                  devon@ghostreviews.app
                </a>
                .
              </p>
            </>
          )}

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
