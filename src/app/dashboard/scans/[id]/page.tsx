import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AnalysisReport } from "@/components/AnalysisReport";
import { AnalyzeResponseSchema } from "@/lib/analysis-schema";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * A single saved scan, rendered with the exact same report component
 * as a live scan. Row Level Security guarantees users can only load
 * their own scans — a foreign id simply returns no row.
 */
export default async function ScanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createSupabaseServer();
  if (!supabase) redirect("/login");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: scan } = await supabase
    .from("scans")
    .select("id, created_at, response")
    .eq("id", id)
    .maybeSingle();

  if (!scan) notFound();

  const parsed = AnalyzeResponseSchema.safeParse(scan.response);
  if (!parsed.success) notFound();

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
          <Link
            href="/dashboard"
            className="text-sm text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
          >
            ← Back to scan history
          </Link>
        </div>
      </header>

      <section className="px-6 py-10 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <p className="mb-6 text-xs text-[color:var(--muted)]">
            Saved scan from {new Date(scan.created_at).toLocaleString()}
          </p>
          <AnalysisReport data={parsed.data} />
        </div>
      </section>
    </div>
  );
}
