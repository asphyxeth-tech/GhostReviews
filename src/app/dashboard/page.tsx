import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAdminEmails } from "@/lib/admin";
import { Wordmark } from "@/components/Wordmark";

export const dynamic = "force-dynamic";

const RISK_TEXT: Record<string, string> = {
  low: "text-emerald-300",
  medium: "text-amber-300",
  high: "text-orange-300",
  critical: "text-red-300",
};

type ScanRow = {
  id: string;
  business_url: string;
  reviews_analyzed: number;
  reviews_total: number | null;
  risk_score: number;
  risk_level: string;
  flagged_count: number;
  reviews_source: string;
  created_at: string;
};

/**
 * The customer's scan history. Every scan run while signed in lands
 * here automatically; clicking a row re-opens the full saved report.
 */
export default async function DashboardPage() {
  const supabase = await createSupabaseServer();
  if (!supabase) redirect("/login");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Admins (ADMIN_EMAILS allowlist) get a one-click link to the prospecting
  // dashboard; everyone else never sees it.
  const isAdmin = Boolean(
    user.email && getAdminEmails().includes(user.email.toLowerCase()),
  );

  const { data } = await supabase
    .from("scans")
    .select(
      "id, business_url, reviews_analyzed, reviews_total, risk_score, risk_level, flagged_count, reviews_source, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const scans = (data ?? []) as ScanRow[];

  return (
    <div className="ghost-bg flex flex-1 flex-col">
      <header className="px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 font-mono text-base tracking-tight"
          >
            <Wordmark />
          </Link>
          <div className="flex items-center gap-4 text-sm text-[color:var(--muted)]">
            {isAdmin && (
              <Link
                href="/admin"
                className="rounded-md border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20"
              >
                Prospecting →
              </Link>
            )}
            <span className="hidden sm:inline">{user.email}</span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-medium text-[color:var(--muted-strong)] transition hover:border-[color:var(--accent)]/50 hover:text-[color:var(--foreground)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="px-6 py-10 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Scan history
              </h1>
              <p className="mt-2 text-sm text-[color:var(--muted-strong)]">
                Every scan you run while signed in is saved here.
              </p>
            </div>
            <Link
              href="/"
              className="rounded-lg bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)]"
            >
              New scan
            </Link>
          </div>

          <div className="mt-8 rounded-2xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/[0.06] p-6 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <h2 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
                  Want us to handle this for you?
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted-strong)]">
                  Scanning is only half the job. With{" "}
                  <strong className="font-medium text-[color:var(--foreground)]">
                    ongoing monitoring
                  </strong>{" "}
                  we re-scan your profile on a schedule and alert you the moment
                  new flagged reviews appear — so an attack never catches you
                  unaware. With{" "}
                  <strong className="font-medium text-[color:var(--foreground)]">
                    done-for-you concierge
                  </strong>{" "}
                  you add us as a Manager on your Google Business Profile and we
                  file the policy-violation reports for you, then track each
                  outcome.
                </p>
                <p className="mt-3 text-xs leading-relaxed text-[color:var(--muted)]">
                  Independent · based in London, ON · you stay in control of your
                  Google profile — you can remove our access anytime.
                </p>
              </div>
              <a
                href="mailto:devon@ghostreviews.app?subject=Ghost%20Reviews%20%E2%80%94%20monitoring%20%2B%20done-for-you&body=I%27m%20signed%20in%20and%20I%27d%20like%20help%20protecting%20my%20reviews.%20I%27m%20interested%20in%20ongoing%20monitoring%20and%2For%20the%20done-for-you%20concierge%20%28filing%20removal%20requests%20as%20a%20Manager%20on%20my%20Google%20profile%29.%20Here%27s%20my%20Google%20Business%20Profile%3A%20"
                className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-[color:var(--accent)] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)] lg:self-auto"
              >
                Talk to us about your profile →
              </a>
            </div>
          </div>

          {scans.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-8 text-sm text-[color:var(--muted-strong)]">
              No scans saved yet. Run a scan from the{" "}
              <Link href="/" className="text-[color:var(--accent)] underline">
                homepage
              </Link>{" "}
              while signed in and it will show up here.
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              {scans.map((scan) => (
                <Link
                  key={scan.id}
                  href={`/dashboard/scans/${scan.id}`}
                  className="block rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[color:var(--foreground)]">
                        {scan.business_url}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--muted)]">
                        <span>
                          {new Date(scan.created_at).toLocaleString()}
                        </span>
                        <span>
                          {scan.reviews_analyzed} reviews analyzed
                          {typeof scan.reviews_total === "number"
                            ? ` of ${scan.reviews_total.toLocaleString()}`
                            : ""}
                        </span>
                        <span>{scan.flagged_count} flagged</span>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-semibold tabular-nums">
                        {scan.risk_score}
                      </span>
                      <span
                        className={`text-xs font-semibold uppercase tracking-widest ${RISK_TEXT[scan.risk_level] ?? ""}`}
                      >
                        {scan.risk_level}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
