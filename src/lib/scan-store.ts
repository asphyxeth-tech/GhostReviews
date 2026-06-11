import { type AnalyzeResponse } from "./analysis-schema";
import { createSupabaseServer } from "./supabase/server";

/**
 * Persist a completed scan for the signed-in user, if there is one.
 *
 * Fire-and-forget by design: scan persistence must NEVER break the scan
 * itself. Anonymous users, missing Supabase config, and database hiccups
 * all silently no-op — the caller returns the report to the browser
 * either way.
 */
export async function saveScanIfAuthenticated(
  response: AnalyzeResponse,
  opts: { towerRunSeq?: number } = {},
): Promise<void> {
  try {
    const supabase = await createSupabaseServer();
    if (!supabase) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Deep audits get re-polled by the client; don't save the same Tower
    // run twice. (Two cheap queries beat fighting ON CONFLICT against a
    // partial unique index through the JS client.)
    if (opts.towerRunSeq != null) {
      const { data: existing } = await supabase
        .from("scans")
        .select("id")
        .eq("user_id", user.id)
        .eq("tower_run_seq", opts.towerRunSeq)
        .maybeSingle();
      if (existing) return;
    }

    await supabase.from("scans").insert({
      user_id: user.id,
      business_url: response.business_url,
      mode: response.mode,
      reviews_source: response.reviews_source,
      reviews_total: response.reviews_total ?? null,
      reviews_analyzed: response.report.total_reviews_analyzed,
      risk_score: response.report.overall_risk_score,
      risk_level: response.report.risk_level,
      flagged_count: response.report.flagged_reviews.length,
      tower_run_seq: opts.towerRunSeq ?? null,
      response,
    });
  } catch {
    // Persistence is best-effort; the scan result still goes back to the
    // user even if saving failed.
  }
}
