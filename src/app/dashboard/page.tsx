import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

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
            <span
              aria-hidden
              className="glow-pulse inline-block h-2 w-2 rounded-full bg-[color:var(--accent)]"
            />
            <span><span className="text-[color:var(--accent)]">/</span>ghostreviews<span className="text-[color:var(--accent)]">/</span></span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-[color:var(--muted)]">
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
